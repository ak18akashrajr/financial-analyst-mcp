// Covers a fix to src/pages/RiskMetrics.tsx: the "Risk per ₹1 Return" stat used to render a bare
// "—" with no explanation whenever the trailing annualized return was zero or negative (the only
// case riskPerRupeeOfReturn is null — see src/lib/riskMetrics.ts), which a user flagged as looking
// like a blank/broken tile. It now shows an inline reason instead, and a new "Ann. Return" tile
// makes the driving figure visible directly rather than requiring a trip to the per-holding table.
// Follows the repo convention (CLAUDE.md, src/test/exposure-section.test.tsx) of mocking the
// data-fetching hook/client directly rather than driving a real Supabase client — mirrors
// src/test/benchmark-page.test.tsx's approach for its own supabase.from() mocking.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RiskMetrics from '@/pages/RiskMetrics';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { DerivedHolding } from '@/types/portfolio';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
const mockedUsePortfolio = vi.mocked(usePortfolio);

const { historicalPriceRows } = vi.hoisted(() => ({
  historicalPriceRows: [] as Array<{ symbol: string; date: string; close: number }>,
}));

// The real query orders newest-first (`.order('date', {ascending: false})`) — RiskMetrics.tsx
// relies on that ordering to correctly slice+reverse each symbol's most recent N closes back into
// ascending (oldest -> newest) order before computing returns. Sorting here too (not just pushing
// in whatever order the test wrote the fixture) mirrors that real behavior; skipping it silently
// fed the page dates in the wrong order and inverted the sign of every computed return.
function sortedByDateDescending<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'historical_prices') {
        return {
          select: () => ({
            in: (_col: string, symbols: string[]) => ({
              order: () => Promise.resolve({
                data: sortedByDateDescending(historicalPriceRows.filter(r => symbols.includes(r.symbol))),
                error: null,
              }),
            }),
          }),
        };
      }
      // benchmark_history: no NIFTY50 data seeded in any of these tests — irrelevant to what's
      // being tested here (Risk per ₹1 Return doesn't depend on benchmark data at all).
      return { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) };
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: { benchmarks: {} }, error: null }) },
  },
}));

function holding(overrides: Partial<DerivedHolding>): DerivedHolding {
  return {
    symbol: 'AAPL',
    totalQuantity: 10,
    totalInvested: 1000,
    avgPrice: 100,
    currentPrice: 100,
    currentValue: 1000,
    pnl: 0,
    pnlPercent: 0,
    transactions: [],
    ...overrides,
  };
}

function mockPortfolio(holdings: DerivedHolding[]) {
  mockedUsePortfolio.mockReturnValue({
    holdings,
    loading: false,
  } as unknown as ReturnType<typeof usePortfolio>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RiskMetrics />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('RiskMetrics page — Risk per ₹1 Return null-state clarity', () => {
  beforeEach(() => {
    historicalPriceRows.length = 0;
  });

  it('shows an inline reason instead of a bare dash when the trailing return is negative', async () => {
    // A steady ~1%/day decline -> negative annualized return -> riskPerRupeeOfReturn is null.
    for (let i = 0; i < 20; i++) {
      historicalPriceRows.push({ symbol: 'AAPL', date: `2026-01-${String(i + 1).padStart(2, '0')}`, close: 100 * 0.99 ** i });
    }
    mockPortfolio([holding({})]);

    renderPage();

    await waitFor(() => expect(screen.getByText(/n\/a — trailing return is/i)).toBeInTheDocument());
    // The driving "Ann. Return" figure is now visible directly (stat tile + table column), not
    // just inferable from the table alone.
    expect(screen.getAllByText(/ann\. return/i).length).toBeGreaterThan(0);
  });

  it('shows a real ₹ value with no "n/a" note when the trailing return is positive', async () => {
    // A varying-but-net-positive series so volatility is nonzero too.
    const closes = [100, 98, 103, 101, 107, 104, 110, 108, 115, 112, 120, 117, 125, 122, 130, 127, 135, 132, 140, 138];
    closes.forEach((close, i) => {
      historicalPriceRows.push({ symbol: 'AAPL', date: `2026-01-${String(i + 1).padStart(2, '0')}`, close });
    });
    mockPortfolio([holding({})]);

    renderPage();

    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/n\/a — trailing return is/i)).not.toBeInTheDocument();
    expect(screen.getByText('Risk per ₹1 Return')).toBeInTheDocument();
  });

  it('shows the empty state, not a crash, when there are no priced holdings', async () => {
    mockPortfolio([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/no holdings with a live price yet/i)).toBeInTheDocument());
  });
});
