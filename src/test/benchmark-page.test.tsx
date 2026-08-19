// Covers the benchmark comparison page (src/pages/Benchmark.tsx): empty states, the rebased
// portfolio-vs-benchmark stats, and privacy masking. Follows the repo convention of mocking
// dependencies directly (CLAUDE.md) rather than driving a real Supabase client — see
// src/test/exposure-section.test.tsx for the pattern this extends to a data-fetching page.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Benchmark from '@/pages/Benchmark';

function renderPage() {
  return render(
    <MemoryRouter>
      <Benchmark />
    </MemoryRouter>,
  );
}

const { netWorthRows, benchmarkRows, invokeMock } = vi.hoisted(() => ({
  netWorthRows: [] as { recorded_at: string; net_worth: number }[],
  benchmarkRows: [] as { date: string; close: number }[],
  invokeMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'net_worth_history') {
        return { select: () => ({ order: () => Promise.resolve({ data: netWorthRows, error: null }) }) };
      }
      if (table === 'benchmark_history') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: benchmarkRows, error: null }) }) }) };
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

  it('shows an empty-state message when there is no AUM history yet', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no aum history yet/i)).toBeInTheDocument());
  });

  it('prompts to backfill when AUM history exists but the benchmark has no data', async () => {
    netWorthRows.push({ recorded_at: '2026-01-01T00:00:00Z', net_worth: 100000 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/no nifty50 data yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /backfill nifty 50 data/i })).toBeInTheDocument();
  });

  it('computes rebased portfolio/benchmark returns once both histories overlap', async () => {
    netWorthRows.push(
      { recorded_at: '2026-01-01T00:00:00Z', net_worth: 100000 },
      { recorded_at: '2026-02-01T00:00:00Z', net_worth: 115000 }, // +15%
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

  it('masks return figures when privacy mode is toggled on', async () => {
    netWorthRows.push(
      { recorded_at: '2026-01-01T00:00:00Z', net_worth: 100000 },
      { recorded_at: '2026-02-01T00:00:00Z', net_worth: 110000 },
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
