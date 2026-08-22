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
    totalPortfolioValue: 0, xirr: 0.12,
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
});
