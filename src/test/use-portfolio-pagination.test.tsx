// usePortfolio must read every transaction, not just the first 1,000 PostgREST returns (audit H6).
// `transactions` is the sole input to FIFO cost basis, XIRR, tax lots and holdings, so a silently
// truncated read corrupts every figure in the app. The mock enforces the real API's response cap:
// no response ever has more than 1,000 rows, whether or not `.range()` asked for more.
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

const { transactionRows, rangeCalls } = vi.hoisted(() => ({
  transactionRows: [] as Array<{ id: string; symbol: string; type: string; quantity: number; price: number; date: string }>,
  rangeCalls: [] as Array<[number, number]>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({
            order: () => ({
              order: () => {
                const q: any = {
                  eq: () => q,
                  range: (from: number, to: number) => {
                    rangeCalls.push([from, to]);
                    const end = Math.min(to + 1, from + 1000); // PostgREST's silent response cap
                    return Promise.resolve({ data: transactionRows.slice(from, end), error: null });
                  },
                };
                return q;
              },
            }),
          }),
        };
      }
      if (table === 'cash_settings') {
        return {
          select: () => Promise.resolve({
            data: [{ liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 }],
            error: null,
          }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: [{ symbol: 'TCS', price: 100 }], error: null }) };
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

describe('usePortfolio transaction loading (1,000-row response cap)', () => {
  it('loads every transaction when there are more than 1,000, including the oldest', async () => {
    // 1,200 one-share BUYs, newest first — the order the hook asks for. Unpaged, the cap would drop the
    // oldest 200 and holdings would read 1,000 shares / ₹1,00,000 invested.
    transactionRows.length = 0;
    rangeCalls.length = 0;
    for (let i = 1200; i >= 1; i--) {
      transactionRows.push({
        id: `t${String(i).padStart(5, '0')}`,
        symbol: 'TCS',
        type: 'BUY',
        quantity: 1,
        price: 100,
        date: new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString(),
      });
    }

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.transactions).toHaveLength(1200);
    const tcs = result.current.holdings.find(h => h.symbol === 'TCS');
    expect(tcs!.totalQuantity).toBe(1200);
    expect(tcs!.totalInvested).toBe(120_000);
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]]);
  });
});
