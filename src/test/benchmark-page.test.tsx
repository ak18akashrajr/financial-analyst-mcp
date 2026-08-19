// Covers the benchmark comparison page (src/pages/Benchmark.tsx): empty states, the rebased
// portfolio-vs-benchmark stats, and privacy masking. Follows the repo convention of mocking
// dependencies directly (CLAUDE.md) rather than driving a real Supabase client — see
// src/test/exposure-section.test.tsx for the pattern this extends to a data-fetching page.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Benchmark from '@/pages/Benchmark';
import { TooltipProvider } from '@/components/ui/tooltip';

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Benchmark />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const { netWorthRows, benchmarkRows, invokeMock } = vi.hoisted(() => ({
  netWorthRows: [] as { recorded_at: string; portfolio_value: number }[],
  benchmarkRows: [] as { date: string; close: number }[],
  invokeMock: vi.fn(),
}));

// Sorts and limits the same way the real Supabase query does — the page orders newest-first and
// limits to windowDays+1 rows, then reverses client-side, so the mock needs to honor both to
// exercise that logic rather than just echoing back whatever was pushed.
function sortedAndLimited<T extends Record<string, unknown>>(rows: T[], dateKey: string, ascending: boolean | undefined, n: number): T[] {
  const sorted = [...rows].sort((a, b) => {
    const diff = new Date(a[dateKey] as string).getTime() - new Date(b[dateKey] as string).getTime();
    return ascending === false ? -diff : diff;
  });
  return sorted.slice(0, n);
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'net_worth_history') {
        return {
          select: () => ({
            order: (col: string, opts?: { ascending?: boolean }) => ({
              limit: (n: number) => Promise.resolve({ data: sortedAndLimited(netWorthRows, col, opts?.ascending, n), error: null }),
            }),
          }),
        };
      }
      if (table === 'benchmark_history') {
        return {
          select: () => ({
            eq: () => ({
              order: (col: string, opts?: { ascending?: boolean }) => ({
                limit: (n: number) => Promise.resolve({ data: sortedAndLimited(benchmarkRows, col, opts?.ascending, n), error: null }),
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

describe('Benchmark page', () => {
  beforeEach(() => {
    netWorthRows.length = 0;
    benchmarkRows.length = 0;
    invokeMock.mockReset().mockResolvedValue({ data: { benchmarks: {} }, error: null });
  });

  it('shows an empty-state message when there is no portfolio history yet', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no portfolio history yet/i)).toBeInTheDocument());
  });

  it('prompts to backfill when portfolio history exists but the benchmark has no data', async () => {
    netWorthRows.push({ recorded_at: '2026-01-01T00:00:00Z', portfolio_value: 100000 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/no nifty50 data yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /backfill nifty 50 data/i })).toBeInTheDocument();
  });

  it('computes rebased portfolio/benchmark returns once both histories overlap', async () => {
    netWorthRows.push(
      { recorded_at: '2026-01-01T00:00:00Z', portfolio_value: 100000 },
      { recorded_at: '2026-02-01T00:00:00Z', portfolio_value: 115000 }, // +15%
    );
    benchmarkRows.push(
      { date: '2026-01-01', close: 20000 },
      { date: '2026-02-01', close: 21000 }, // +5%
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Portfolio Return')).toBeInTheDocument());
    expect(screen.getByText('+15.00%')).toBeInTheDocument(); // portfolio
    expect(screen.getByText('+5.00%')).toBeInTheDocument(); // benchmark
    expect(screen.getByText('+10.00%')).toBeInTheDocument(); // outperformance
  });

  it('recomputes over a narrower window when a shorter lookback is selected', async () => {
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    const dayMs = 86400000;
    for (let i = 0; i < 35; i++) {
      const iso = new Date(base + i * dayMs).toISOString();
      netWorthRows.push({ recorded_at: iso, portfolio_value: 100000 + i * 1000 }); // day0=100000 … day34=134000
      benchmarkRows.push({ date: iso.slice(0, 10), close: 20000 + i * 100 });
    }
    renderPage();
    await waitFor(() => expect(screen.getByText('Portfolio Return')).toBeInTheDocument());
    // Default window is 90d (limit 91) → all 35 rows included: (134000-100000)/100000*100 = 34.00%
    expect(screen.getByText('+34.00%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    // 30d window (limit 31) → most recent 31 rows only, i.e. day4..day34: (134000-104000)/104000*100 = 28.85%
    await waitFor(() => expect(screen.getByText('+28.85%')).toBeInTheDocument());
  });

  it('shows a definition tooltip when a stat label hint is clicked', async () => {
    netWorthRows.push(
      { recorded_at: '2026-01-01T00:00:00Z', portfolio_value: 100000 },
      { recorded_at: '2026-02-01T00:00:00Z', portfolio_value: 115000 },
    );
    benchmarkRows.push(
      { date: '2026-01-01', close: 20000 },
      { date: '2026-02-01', close: 21000 },
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Portfolio Return')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /what is portfolio return/i }));
    // Radix's Tooltip renders the content into more than one DOM node (visible + accessibility
    // copies), so assert presence via getAllByText rather than the single-match getByText.
    await waitFor(() => expect(screen.getAllByText(/excludes cash, pf and liabilities/i).length).toBeGreaterThan(0));
  });

  it('masks return figures when privacy mode is toggled on', async () => {
    netWorthRows.push(
      { recorded_at: '2026-01-01T00:00:00Z', portfolio_value: 100000 },
      { recorded_at: '2026-02-01T00:00:00Z', portfolio_value: 110000 },
    );
    benchmarkRows.push(
      { date: '2026-01-01', close: 20000 },
      { date: '2026-02-01', close: 21000 },
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Portfolio Return')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /hide numbers/i }));
    await waitFor(() => expect(screen.getAllByText('••••••').length).toBeGreaterThan(0));
  });
});
