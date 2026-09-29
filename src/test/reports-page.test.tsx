// Covers two fixes to src/pages/Reports.tsx:
//  1. The projection audit popover used to hardcode "Start value (V₀)" to ₹0 for any
//     upcoming period, even though the real projection math starts from startSnap.netWorth.
//  2. A holding falling back to cost basis (no historical_prices row at-or-before the
//     mark date) used to be signalled only by a small chip — now a prominent banner
//     calls it out, since it silently flattens P&L to 0% everywhere on the page.
// Follows the repo convention (CLAUDE.md, src/test/exposure-section.test.tsx) of mocking
// the data-fetching hook directly rather than driving real Supabase queries; Reports.tsx
// also talks to supabase directly (net_worth_history/period_reports/historical_prices),
// so those are mocked too, the way src/test/benchmark-page.test.tsx does for its page.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reports from '@/pages/Reports';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { Transaction, CurrentPrices, CashSettings, PortfolioSummary } from '@/types/portfolio';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
const mockedUsePortfolio = vi.mocked(usePortfolio);

const { historicalPriceRows } = vi.hoisted(() => ({
  historicalPriceRows: [] as Array<{ symbol: string; date: string; close: number }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'historical_prices') {
        return {
          select: () => ({
            order: () => ({
              range: (from: number, to: number) =>
                Promise.resolve({ data: historicalPriceRows.slice(from, to + 1), error: null }),
            }),
          }),
        };
      }
      // net_worth_history and period_reports: no rows in any of these tests.
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

function baseHookValue(overrides: {
  transactions: Transaction[];
  currentPrices?: CurrentPrices;
}) {
  const summary: PortfolioSummary = {
    investedValue: 0, currentValue: 0, totalPnl: 0, totalPnlPercent: 0,
    liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0,
    totalPortfolioValue: 0, xirr: 0.12, xirrExPf: 0.12,
  };
  const cash: CashSettings = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
  return {
    transactions: overrides.transactions,
    currentPrices: overrides.currentPrices ?? {},
    symbolMetadata: {},
    cash,
    summary,
    loading: false,
  } as unknown as ReturnType<typeof usePortfolio>;
}

function renderReports() {
  return render(<MemoryRouter><Reports /></MemoryRouter>);
}

describe('Reports page', () => {
  beforeEach(() => {
    historicalPriceRows.length = 0;
    // Fix "now" inside FY2026-27 Q2 (Jul-Sep 2026), so Q1 is completed, Q4 is upcoming.
    // Only fake Date (not setTimeout/setInterval) so testing-library's waitFor still ticks.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a prominent staleness warning when a holding falls back to cost basis for a completed period', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    // Default active period is the in-progress one (Q2); switch to the completed Q1 so the
    // holding is marked historically (or falls back to cost) instead of live.
    await waitFor(() => expect(screen.getByRole('button', { name: /Q1 2026-27/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Q1 2026-27/ }));

    // No historical_prices row exists for TCS at all → cost-fallback → banner shown.
    await waitFor(() =>
      expect(screen.getByText(/1 of 1 holding.*marked at cost, not a real price/i)).toBeInTheDocument(),
    );
  });

  it('does not show the staleness warning once a real historical close exists for the mark date', async () => {
    historicalPriceRows.push({ symbol: 'TCS', date: '2026-06-01', close: 120 });
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    await waitFor(() => expect(screen.getByRole('button', { name: /Q1 2026-27/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Q1 2026-27/ }));

    await waitFor(() => expect(screen.getByText('Q1 · Apr–Jun 2026')).toBeInTheDocument());
    expect(screen.queryByText(/marked at cost, not a real price/i)).not.toBeInTheDocument();
  });

  it('shows the real projection start value (not a hardcoded ₹0) for an upcoming period', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 100, price: 123.45, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    // Q4 FY2026-27 (Jan-Mar 2027) is upcoming relative to the fixed "now" of Aug 2026.
    await waitFor(() => expect(screen.getByRole('button', { name: /Q4 2026-27/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Q4 2026-27/ }));
    await waitFor(() => expect(screen.getByText('Forward Projection')).toBeInTheDocument());

    // No historical_prices/net_worth_history rows at all → startSnap marks TCS at cost basis:
    // 100 qty × ₹123.45 = ₹12,345, no cash → startSnap.netWorth = ₹12,345 (not the old
    // hardcoded ₹0). Scope to the "Start value" row specifically since the page also shows
    // ₹12,345 elsewhere (e.g. Principal Capital Allocated) — this must not be confused with
    // those other, coincidentally-identical figures.
    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Base Case Projection/i }));
    await waitFor(() => expect(screen.getByText('Start value (V₀)')).toBeInTheDocument());
    const startValueRow = screen.getByText('Start value (V₀)').closest('tr');
    expect(startValueRow).not.toBeNull();
    expect(within(startValueRow!).getByText('₹12,345')).toBeInTheDocument();
  });

  it('lets you browse to an earlier fiscal year and shows that FY\'s periods', async () => {
    // A transaction from FY2024-25 pushes the earliest-browsable FY back from the
    // default (current FY, 2026-27) far enough that "previous FY" is enabled twice.
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2024-05-01' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    await waitFor(() => expect(screen.getByText('FY2026-27')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Previous fiscal year/i }));
    await waitFor(() => expect(screen.getByText('FY2025-26')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Q1 2025-26/ })).toBeInTheDocument();

    // Can't go past the earliest transaction's FY (2024-25).
    fireEvent.click(screen.getByRole('button', { name: /Previous fiscal year/i }));
    await waitFor(() => expect(screen.getByText('FY2024-25')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Previous fiscal year/i })).toBeDisabled();
  });

  it('is disabled from browsing past the current fiscal year', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    await waitFor(() => expect(screen.getByText('FY2026-27')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next fiscal year/i })).toBeDisabled();
  });

  it('shows a YoY growth chip comparing AUM to the same calendar date one year ago', async () => {
    historicalPriceRows.push({ symbol: 'TCS', date: '2025-08-01', close: 120 });
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2025-04-15' }],
      currentPrices: { TCS: 200 },
    }));
    renderReports();

    // Default active period is in-progress Q2 FY2026-27 (asOf = "now" = 2026-08-22).
    // Prior year (2025-08-22) marks TCS at its ₹120 historical close → netWorth ₹1,200.
    // Today, live-marked at ₹200 → netWorth ₹2,000. Δ = 800, % = 800/1200*100 = 66.67%.
    // The AUM Growth chart's own badge repeats this same figure (see the dedicated
    // test below), so this now matches two elements — assert at least the headline
    // chip's occurrence rather than a single exact match.
    await waitFor(() => expect(screen.getAllByText(/\+66\.67% YoY/).length).toBeGreaterThanOrEqual(1));
  });

  it('shows the AUM Growth chart comparing Last Year, previous period, and current period', async () => {
    historicalPriceRows.push({ symbol: 'TCS', date: '2025-08-01', close: 120 });
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2025-04-15' }],
      currentPrices: { TCS: 200 },
    }));
    renderReports();

    // Default active period is in-progress Q2 FY2026-27. Prev period (Q1) and the
    // prior-year point both mark TCS at the only historical close available
    // (2025-08-01 @ ₹120 → netWorth ₹1,200); today is live-marked @ ₹200 → ₹2,000.
    // So both comparisons land on the same 66.67% figure, per the YoY test above.
    // Recharts renders period shortLabels ("Q1 2026-27" etc.) in several places on
    // this page already (period picker, trend chart, P&L bar chart), so scope every
    // assertion to the AUM Growth card itself rather than a page-wide getByText.
    // The bars' own generic wording ("Last Quarter"/"Current Quarter" vs. jsdom's
    // recharts tick rendering, which merges/wraps multi-word tick text under this
    // suite's fixed-size layout stub) is covered precisely by the pure
    // buildGrowthComparison unit tests in period-reports.test.ts instead.
    const heading = await screen.findByText('AUM Growth');
    const card = heading.closest('.rounded-2xl') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText('+66.67% YoY')).toBeInTheDocument();
    expect(
      within(card).getByText('vs previous period (Q1 2026-27): +66.67% · vs last year: +66.67%'),
    ).toBeInTheDocument();
  });

  it('wraps the header action row instead of forcing horizontal page overflow on narrow viewports', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    // Regression guard: this row (Hide numbers / Backfill FY prices / Backfill benchmark
    // data / AI Narrative / Print/PDF) previously had no flex-wrap, so five buttons in one
    // non-wrapping flex row forced the whole page wider than a phone viewport.
    const printButton = await screen.findByRole('button', { name: /Print \/ PDF/i });
    const buttonRow = printButton.closest('div')!;
    expect(buttonRow).toHaveClass('flex-wrap');
    expect(buttonRow.parentElement).toHaveClass('flex-wrap');
  });

  it('stacks the projection cards and Top Movers columns to one column on narrow viewports', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    // Regression guard: these two grids were fixed at grid-cols-2 with no mobile fallback,
    // so the Base/Conservative projection cards and Gainers/Losers columns got cramped on
    // a 320-375px phone screen instead of stacking.
    const projectionCard = await screen.findByText('Base Case (current XIRR) · click to audit');
    expect(projectionCard.closest('.grid')).toHaveClass('grid-cols-1', 'sm:grid-cols-2');

    const moversHeading = screen.getByText('Top Movers (period-end)');
    const moversGrid = moversHeading.parentElement!.querySelector(':scope > .grid');
    expect(moversGrid).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
  });

  it('hides the AUM Growth chart when there is no prior period or prior year to compare against', async () => {
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' }],
      currentPrices: { TCS: 150 },
    }));
    renderReports();

    // Q1 FY2026-27 is both the first period of the FY (no previous period) and the
    // portfolio's very first period ever (no data a year back) — growth is null.
    await waitFor(() => expect(screen.getByRole('button', { name: /Q1 2026-27/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Q1 2026-27/ }));

    await waitFor(() => expect(screen.getByText('Q1 · Apr–Jun 2026')).toBeInTheDocument());
    expect(screen.queryByText('AUM Growth')).not.toBeInTheDocument();
  });

  it('compares H1 against the prior fiscal year\'s H2 instead of showing "First period", when that prior-FY data actually exists', async () => {
    // Only historical close available: ₹130 on 2026-02-01, inside H2 FY2025-26
    // (Oct 2025–Mar 2026) but after the YoY lookback date (2025-08-22).
    historicalPriceRows.push({ symbol: 'TCS', date: '2026-02-01', close: 130 });
    mockedUsePortfolio.mockReturnValue(baseHookValue({
      transactions: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2025-04-15' }],
      currentPrices: { TCS: 200 },
    }));
    renderReports();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Half-Yearly' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Half-Yearly' }));

    // "now" (2026-08-22) falls in H1 FY2026-27 (Apr-Sep 2026) → in-progress → default
    // active period. H1 is index 0 of this FY's half list, so its real predecessor,
    // H2 FY2025-26, isn't in that list at all — it has to be looked up in the prior FY.
    await waitFor(() => expect(screen.getByText('H1 · Apr–Sep 2026')).toBeInTheDocument());
    expect(screen.queryByText('First period')).not.toBeInTheDocument();

    // H2 FY2025-26 ends 2026-04-01; the ₹130 close (2026-02-01) is the latest at-or-before
    // that date → prev netWorth = 10 × ₹130 = ₹1,300. Today, live @ ₹200 → ₹2,000.
    // Δ = 700, % = 700 / 1300 × 100 = 53.8461...% → "+53.85%".
    await waitFor(() => expect(screen.getByText('+53.85% vs H2 2025-26')).toBeInTheDocument());

    // AUM Growth chart should also now render (both yoy and periodOverPeriod resolved).
    expect(screen.getByText('AUM Growth')).toBeInTheDocument();
  });
});
