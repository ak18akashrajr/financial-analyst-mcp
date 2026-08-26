// Confirms usePortfolio.ts's holdings memo actually uses the FIFO cost-basis
// fix (src/lib/costBasis.ts) end-to-end, not just that the helper itself is
// correct — this is the hook that feeds the dashboard, holdings table, and
// every summary figure app-wide.
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

const { transactionRows } = vi.hoisted(() => ({
  transactionRows: [] as Array<{ id: string; symbol: string; type: string; quantity: number; price: number; date: string }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return { select: () => ({ order: () => Promise.resolve({ data: transactionRows, error: null }) }) };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({
            limit: () => ({
              single: () => Promise.resolve({
                data: { liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: [{ symbol: 'TCS', price: 250 }], error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'monthly_cashflow') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

describe('usePortfolio holdings (FIFO cost basis)', () => {
  it('does not let a profitable partial sell inflate the remaining position\'s Invested/P&L', async () => {
    transactionRows.length = 0;
    transactionRows.push(
      { id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' },
      { id: '2', symbol: 'TCS', type: 'SELL', quantity: 5, price: 180, date: '2026-05-01' },
    );

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const tcs = result.current.holdings.find(h => h.symbol === 'TCS');
    expect(tcs).toBeDefined();
    // Old buggy formula: invested = 1000 − (5×180) = 100, avgPrice = ₹20.
    // Fixed FIFO: the 5 remaining shares are still costed at their original ₹100.
    expect(tcs!.totalQuantity).toBe(5);
    expect(tcs!.avgPrice).toBe(100);
    expect(tcs!.totalInvested).toBe(500);
    // Current price 250 → P&L = (250-100)*5 = 750, not the inflated (250-20)*5 = 1150.
    expect(tcs!.pnl).toBe(750);
  });
});
