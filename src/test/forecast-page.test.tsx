// Covers src/pages/Forecast.tsx: the empty state when there isn't enough priced history yet, the
// thin-sample fallback caveat, the fitted stats rendering once there's a real return series, and
// privacy masking. Follows the repo convention (CLAUDE.md, src/test/exposure-section.test.tsx,
// src/test/risk-metrics-page.test.tsx) of mocking usePortfolio and the Supabase client directly
// rather than driving a real backend.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Forecast, { formatChartTooltipValue } from '@/pages/Forecast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
const mockedUsePortfolio = vi.mocked(usePortfolio);

const { historicalPriceRows, invokeMock } = vi.hoisted(() => ({
  historicalPriceRows: [] as Array<{ symbol: string; date: string; close: number }>,
  invokeMock: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'historical_prices') {
        return {
          select: () => ({
            in: (_col: string, symbols: string[]) => ({
              order: () => Promise.resolve({
                data: [...historicalPriceRows.filter((r) => symbols.includes(r.symbol))].sort(
                  (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
                ),
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
    functions: { invoke: invokeMock },
  },
}));

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: '1', symbol: 'AAPL', type: 'BUY', quantity: 10, price: 100, date: '2026-01-01', ...overrides };
}

const zeroCash = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
const oneCategory = { category: [{ label: 'Stocks', value: 1000, percent: 100 }], geography: [] };

function mockPortfolio(overrides: Partial<ReturnType<typeof usePortfolio>>) {
  mockedUsePortfolio.mockReturnValue({
    transactions: [],
    cash: zeroCash,
    exposure: oneCategory,
    loading: false,
    ...overrides,
  } as unknown as ReturnType<typeof usePortfolio>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Forecast />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** `count` consecutive daily closes for AAPL starting 2026-01-01, drifting gently upward. */
function seedDailyPrices(count: number) {
  const start = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    historicalPriceRows.push({ symbol: 'AAPL', date: d.toISOString().slice(0, 10), close: 100 * 1.001 ** i });
  }
}

describe('Forecast page', () => {
  beforeEach(() => {
    historicalPriceRows.length = 0;
    invokeMock.mockClear();
  });

  it('shows the empty state and a backfill prompt with no transactions at all', async () => {
    mockPortfolio({ transactions: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText(/not enough priced history/i)).toBeInTheDocument());
    // Not a plain getByText: the empty-state copy below also quotes the phrase "Backfill 2y daily
    // prices" ("Click \"Backfill 2y daily prices\" above…"), so a text match hits two elements —
    // the button itself is unambiguous.
    expect(screen.getByRole('button', { name: /backfill 2y daily prices/i })).toBeInTheDocument();
  });

  it('shows the empty state when transactions exist but there is no price history yet', async () => {
    mockPortfolio({ transactions: [txn({})] });
    renderPage();

    await waitFor(() => expect(screen.getByText(/not enough priced history/i)).toBeInTheDocument());
  });

  it('flags the thin-sample fallback caveat with too few return observations', async () => {
    seedDailyPrices(5); // 4 flow-adjusted returns — well under MIN_OBSERVATIONS (60)
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Fitted Drift')).toBeInTheDocument());
    expect(screen.getByText(/return observations available/i)).toBeInTheDocument();
    expect(screen.getByText(/blended asset-class assumptions/i)).toBeInTheDocument();
  });

  it('renders the fitted stats with no fallback caveat once there is enough history', async () => {
    seedDailyPrices(90); // 89 returns — comfortably over MIN_OBSERVATIONS
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Fitted Drift')).toBeInTheDocument());
    expect(screen.queryByText(/blended asset-class assumptions/i)).not.toBeInTheDocument();
    expect(screen.getByText('Fitted Volatility')).toBeInTheDocument();
    expect(screen.getByText('Current Value')).toBeInTheDocument();
  });

  it('restricts the fit to the selected lookback window without changing the default (All) behavior', async () => {
    // ~2.4 years of daily prices — enough that a 1y lookback is a real, meaningfully smaller subset
    // of the full history, not the same set filtered down to nothing.
    seedDailyPrices(880);
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    // "price history ·" only appears in the header line, disambiguating it from the bottom summary
    // paragraph, which also mentions "return observations".
    const observationText = () => screen.getByText(/price history ·/i).textContent ?? '';
    const observationCount = (text: string) => Number(text.match(/(\d+) return observations/)?.[1] ?? NaN);

    await waitFor(() => expect(screen.getByText('Fitted Drift')).toBeInTheDocument());
    const allCount = observationCount(observationText());
    expect(allCount).toBe(879); // 880 daily points -> 879 consecutive returns, matching pre-lookback-control behavior

    // "1y"/"5y" also appear as Horizon button labels (12mo/60mo), so scope every query to the
    // Lookback control's own container, found via its "Lookback" label.
    const lookbackGroup = screen.getByText('Lookback').closest('div')!.parentElement as HTMLElement;

    // "All" should be the pre-selected default — the lookback control must not change existing
    // behavior for anyone who never touches it.
    expect(within(lookbackGroup).getByRole('button', { name: 'All' })).toHaveClass('bg-foreground');

    fireEvent.click(within(lookbackGroup).getByRole('button', { name: '1y' }));

    await waitFor(() => expect(observationCount(observationText())).toBeLessThan(allCount));
    const oneYearCount = observationCount(observationText());
    // A 1-year daily lookback should land in the low-to-mid 300s, not near-zero and not near the full count.
    expect(oneYearCount).toBeGreaterThan(300);
    expect(oneYearCount).toBeLessThan(400);

    // Switching back to "All" restores the original, unrestricted count.
    fireEvent.click(within(lookbackGroup).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(observationCount(observationText())).toBe(allCount));
  });

  it('reports too little history to backtest at the default 24-month horizon with only 90 days of prices', async () => {
    // Default horizon is 24 months; at daily (252/yr) spacing that needs on the order of
    // 60 (MIN_OBSERVATIONS) + 24*21 ≈ 564 priced days for even one walk-forward fold — 90 is
    // nowhere near enough, and the panel must say so rather than show an empty/broken table.
    seedDailyPrices(90);
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Backtest')).toBeInTheDocument());
    expect(screen.getByText(/not enough history yet to backtest/i)).toBeInTheDocument();
    expect(screen.queryByText('Band Coverage')).not.toBeInTheDocument();
  });

  it('renders backtest coverage stats and a fold table once there is enough history for the selected horizon', async () => {
    seedDailyPrices(300);
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    // Switch to a 6-month horizon — the default 24-month horizon needs ~564 priced days (see the
    // test above) to produce even one fold, more than this fixture seeds.
    const horizonButton = await screen.findByRole('button', { name: '6mo' });
    fireEvent.click(horizonButton);

    await waitFor(() => expect(screen.getByText('Band Coverage')).toBeInTheDocument());
    expect(screen.getByText('Median Error')).toBeInTheDocument();
    expect(screen.getByText('Cutoff')).toBeInTheDocument();
    expect(screen.getByText('Predicted p10–p90')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByText('Covered')).toBeInTheDocument();
  });

  it('masks the current-value figure when privacy mode is toggled on', async () => {
    seedDailyPrices(90);
    mockPortfolio({ transactions: [txn({ date: '2026-01-01' })] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Current Value')).toBeInTheDocument());
    // Scope to the "Current Value" stat card specifically, rather than counting ₹ signs across the
    // whole page — several other elements (the cash caveat line, other stat tiles) also render one.
    const card = screen.getByText('Current Value').closest('.rounded-xl') as HTMLElement;
    expect(within(card).getByText(/₹/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hide numbers/i));

    await waitFor(() => expect(screen.getByText(/show numbers/i)).toBeInTheDocument());
    expect(within(card).getByText('••••••')).toBeInTheDocument();
    expect(within(card).queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('invokes fetch-historical-prices for every held symbol when Backfill is clicked', async () => {
    mockPortfolio({ transactions: [txn({ symbol: 'AAPL' }), txn({ symbol: 'MSFT', date: '2026-01-02' })] });
    renderPage();

    const button = await screen.findByRole('button', { name: /backfill 2y daily prices/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('fetch-historical-prices', {
        body: { symbols: ['AAPL', 'MSFT'], range: '2y', interval: '1d' },
      }),
    );
    // Wait for the whole handler (including its post-invoke reload and state reset) to settle,
    // not just the invoke call itself — otherwise a state update from loadPrices()/setBackfilling
    // lands after the test has already finished, outside any act() batch.
    await waitFor(() => expect(button).toHaveTextContent(/backfill 2y daily prices/i));
  });

  it('shows a loading state while the portfolio hook is still loading', () => {
    mockPortfolio({ loading: true });
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('formatChartTooltipValue', () => {
  const fmt = (n: number) => `₹${n}`;

  it('formats a plain number with the given formatter', () => {
    expect(formatChartTooltipValue(1000, fmt)).toBe('₹1000');
  });

  it('formats a [p10, p90] tuple as a range, not "₹NaN"', () => {
    // Regression case: the `band` series' recharts Area dataKey holds a [lo, hi] tuple (the
    // range-Area convention). Calling a plain currency formatter directly on that array silently
    // produced "₹NaN" instead of throwing — this is exactly the shape that shipped broken.
    expect(formatChartTooltipValue([100, 200], fmt)).toBe('₹100 – ₹200');
  });

  it('never contains the literal string "NaN" for either input shape', () => {
    expect(formatChartTooltipValue(500, fmt)).not.toContain('NaN');
    expect(formatChartTooltipValue([500, 900], fmt)).not.toContain('NaN');
  });
});
