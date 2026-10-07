// The Rolling Returns summary table's 1Y/3Y/5Y columns must show "—" for a window the position/portfolio
// hasn't existed for yet (audit M6). They used to call the ungated XIRR, so a position held ~4 months showed its
// annualised 4-month figure under 1Y, 3Y and 5Y alike. The compute functions' own math is covered by
// src/test/rolling-returns.test.ts; this checks the page applies the gate. usePortfolio is mocked per CLAUDE.md.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RollingReturns from '@/pages/RollingReturns';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/hooks/usePortfolio', () => ({ usePortfolio: vi.fn() }));

const { priceRows } = vi.hoisted(() => ({
  priceRows: [] as Array<{ id: string; symbol: string; date: string; close: number }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'historical_prices') {
        // Paged via fetchAllPages: .select().in().order(date).order('id').range(from, to).
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                order: () => ({
                  range: (from: number, to: number) => Promise.resolve({ data: priceRows.slice(from, to + 1), error: null }),
                }),
              }),
            }),
          }),
        };
      }
      // SiteFooter (rendered by every page) reads family-member tables through a different chain.
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
  },
}));

const DAY = 24 * 60 * 60 * 1000;
/** A local calendar date `n` days before today, as YYYY-MM-DD — computed from the real clock so it never ages. */
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function seed(buyAgeDays: number) {
  priceRows.length = 0;
  priceRows.push(
    { id: 'p1', symbol: 'AAPL', date: daysAgo(buyAgeDays), close: 100 },
    { id: 'p2', symbol: 'AAPL', date: daysAgo(0), close: 110 },
  );
  const transactions: Transaction[] = [
    { id: 't1', symbol: 'AAPL', type: 'BUY', quantity: 10, price: 100, date: daysAgo(buyAgeDays) },
  ];
  vi.mocked(usePortfolio).mockReturnValue({
    holdings: [{ symbol: 'AAPL' }],
    transactions,
    loading: false,
  } as unknown as ReturnType<typeof usePortfolio>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RollingReturns />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** The 1Y/3Y/5Y cells of the summary-table row whose first cell reads `label` (scoped to the table, since
 * "Overall Portfolio" also appears as an option in the chart's dropdown). */
function rowCells(label: string) {
  const row = within(screen.getByRole('table'))
    .getAllByRole('row')
    .find((r) => within(r).queryAllByRole('cell')[0]?.textContent?.startsWith(label)) as HTMLElement;
  return within(row).getAllByRole('cell').slice(1).map((c) => c.textContent);
}

describe('Rolling Returns summary table — windows without enough history (audit M6)', () => {
  beforeEach(() => {
    priceRows.length = 0;
  });

  it('shows "—" under 1Y, 3Y and 5Y for a position held only ~4 months', async () => {
    seed(122);
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    // Wait for the cached price history to load, so a missing value is down to the gate, not to loading.
    await waitFor(() => expect(priceRows.length).toBeGreaterThan(0));
    expect(rowCells('Overall Portfolio')).toEqual(['—', '—', '—']);
    expect(rowCells('AAPL')).toEqual(['—', '—', '—']);
  });

  it('shows a real 1Y figure — but still "—" for 3Y and 5Y — once the position is ~18 months old', async () => {
    seed(550);
    renderPage();

    await waitFor(() => {
      const [oneYear] = rowCells('AAPL');
      expect(oneYear).toMatch(/%$/);
    });
    const aapl = rowCells('AAPL');
    expect(aapl[0]).toMatch(/^-?\d+\.\d{2}%$/);
    expect(aapl[1]).toBe('—'); // 3Y
    expect(aapl[2]).toBe('—'); // 5Y
    expect(rowCells('Overall Portfolio')[0]).toMatch(/%$/);
    expect(rowCells('Overall Portfolio')[1]).toBe('—');
  });
});
