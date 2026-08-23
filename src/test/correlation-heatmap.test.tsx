// Covers CorrelationHeatmap taking `transactions` as a prop instead of
// calling usePortfolio() itself (docs/perf-findings.md#2) and scoping its
// historical_prices read to just this portfolio's symbols instead of every
// symbol ever fetched anywhere in the app (docs/perf-findings.md#3).
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrelationHeatmap } from '@/components/CorrelationHeatmap';
import type { Transaction } from '@/types/portfolio';

const { historicalPriceRows, fromMock, inMock } = vi.hoisted(() => ({
  historicalPriceRows: [] as Array<{ symbol: string; date: string; close: number }>,
  fromMock: vi.fn(),
  inMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

function txn(symbol: string): Transaction {
  return { id: symbol, symbol, type: 'BUY', quantity: 1, price: 100, date: '2026-01-01' };
}

function setup(rows: typeof historicalPriceRows) {
  historicalPriceRows.length = 0;
  historicalPriceRows.push(...rows);
  fromMock.mockReset();
  inMock.mockReset();
  inMock.mockImplementation((_col: string, symbols: string[]) => ({
    order: () => Promise.resolve({
      data: historicalPriceRows.filter(r => symbols.includes(r.symbol)),
      error: null,
    }),
  }));
  fromMock.mockImplementation((table: string) => {
    if (table === 'historical_prices') {
      return { select: () => ({ in: inMock }) };
    }
    // Any other table (transactions, cash_settings, current_prices,
    // symbol_metadata) being queried here would mean the component fell
    // back to calling usePortfolio() itself — fail loudly instead of
    // silently returning empty data.
    throw new Error(`CorrelationHeatmap queried unexpected table: ${table}`);
  });
}

describe('CorrelationHeatmap', () => {
  it("scopes the historical_prices query to just this portfolio's own symbols", async () => {
    setup([]);
    render(<CorrelationHeatmap transactions={[txn('TCS'), txn('INFY'), txn('TCS')]} />);

    await waitFor(() => expect(inMock).toHaveBeenCalled());
    expect(inMock).toHaveBeenCalledWith('symbol', ['INFY', 'TCS']); // deduped + sorted
  });

  it('does not query historical_prices at all when there are no transactions', async () => {
    setup([]);
    render(<CorrelationHeatmap transactions={[]} />);

    await waitFor(() => expect(screen.queryByText(/loading historical prices/i)).not.toBeInTheDocument());
    expect(inMock).not.toHaveBeenCalled();
  });

  it('shows the correlation table once enough overlapping historical data exists', async () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const rows = dates.flatMap((date, i) => [
      { symbol: 'TCS', date, close: 100 + i },
      { symbol: 'INFY', date, close: 200 - i },
    ]);
    setup(rows);

    render(<CorrelationHeatmap transactions={[txn('TCS'), txn('INFY')]} />);

    await waitFor(() => expect(screen.queryByText(/loading historical prices/i)).not.toBeInTheDocument());
    expect(screen.getAllByText('TCS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('INFY').length).toBeGreaterThan(0);
    expect(fromMock).toHaveBeenCalledWith('historical_prices');
    expect(fromMock).not.toHaveBeenCalledWith('transactions');
    expect(fromMock).not.toHaveBeenCalledWith('cash_settings');
  });

  it('shows the not-enough-data message when there is too little overlapping history', async () => {
    setup([{ symbol: 'TCS', date: '2026-01-01', close: 100 }]);

    render(<CorrelationHeatmap transactions={[txn('TCS')]} />);

    await waitFor(() => expect(screen.queryByText(/loading historical prices/i)).not.toBeInTheDocument());
    expect(screen.getByText(/not enough historical data/i)).toBeInTheDocument();
  });
});
