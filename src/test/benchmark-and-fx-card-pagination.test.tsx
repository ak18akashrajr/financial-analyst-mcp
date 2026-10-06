// XirrDetailsCard (benchmark_history) and DollarReturnsCard (fx_rates) must read every row, not just
// the first 1,000 PostgREST returns (audit H6 follow-up). Daily benchmark bars pass that cap after
// ~4 years, and DollarReturnsCard used `.limit(3000)`, which the same cap silently overrides. The mocks
// enforce the real response cap, so a plain unpaged select would come back with exactly 1,000 rows.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XirrDetailsCard } from '@/components/XirrDetailsCard';
import { DollarReturnsCard } from '@/components/DollarReturnsCard';
import type { DerivedHolding, PortfolioSummary, Transaction } from '@/types/portfolio';

const { benchmarkRows, fxRows, rangeCalls } = vi.hoisted(() => ({
  benchmarkRows: [] as Array<{ date: string; close: number }>,
  fxRows: [] as Array<{ date: string; rate: number; source: string }>,
  rangeCalls: [] as Array<{ table: string; from: number; to: number }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (table === 'benchmark_history' ? benchmarkRows : table === 'fx_rates' ? fxRows : []);
      // .select().eq().order().range(from, to) — what fetchAllPages drives.
      const chain: any = {
        eq: () => chain,
        order: () => chain,
        range: (from: number, to: number) => {
          rangeCalls.push({ table, from, to });
          const end = Math.min(to + 1, from + 1000); // PostgREST's silent response cap
          return Promise.resolve({ data: rows().slice(from, end), error: null });
        },
      };
      return { select: () => chain };
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

const isoDay = (offset: number) => new Date(Date.UTC(2020, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);

describe('benchmark / FX reads page past the 1,000-row cap (audit H6 follow-up)', () => {
  beforeEach(() => {
    benchmarkRows.length = 0;
    fxRows.length = 0;
    rangeCalls.length = 0;
  });

  it('XirrDetailsCard reads a benchmark\'s whole daily history, not just its oldest 1,000 rows', async () => {
    for (let i = 0; i < 1_500; i++) benchmarkRows.push({ date: isoDay(i), close: 100 + i });
    const transactions: Transaction[] = [
      { id: '1', symbol: 'TCS', type: 'BUY', quantity: 1, price: 100, date: isoDay(0) },
    ];

    render(
      <MemoryRouter>
        <XirrDetailsCard overallXirr={0.1} portfolioXirr={0.1} transactions={transactions} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /xirr/i }));

    await waitFor(() =>
      expect(rangeCalls.filter((c) => c.table === 'benchmark_history')).toEqual(
        expect.arrayContaining([
          { table: 'benchmark_history', from: 0, to: 999 },
          { table: 'benchmark_history', from: 1000, to: 1999 },
        ]),
      ),
    );
  });

  it('DollarReturnsCard reads every USDINR rate instead of relying on .limit(3000)', async () => {
    for (let i = 0; i < 1_200; i++) fxRows.push({ date: isoDay(i), rate: 80 + i / 100, source: 'yahoo' });
    const summary = {
      investedValue: 1000,
      currentValue: 1100,
      totalPortfolioValue: 1_000_000,
      totalPnlPercent: 10,
    } as unknown as PortfolioSummary;

    render(
      <MemoryRouter>
        <DollarReturnsCard holdings={[] as DerivedHolding[]} summary={summary} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('USD-Denominated AUM')).toBeInTheDocument());
    expect(rangeCalls.filter((c) => c.table === 'fx_rates')).toEqual([
      { table: 'fx_rates', from: 0, to: 999 },
      { table: 'fx_rates', from: 1000, to: 1999 },
    ]);
  });
});
