// Covers useFamilyNetWorthSplit: it only queries cash_settings (and computes a split) when
// `enabled` is true (activeMemberId === 'all' at the call site) — an individual member's own view
// has nothing to split, so it should never fire the query in that case.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFamilyNetWorthSplit } from '@/hooks/useFamilyNetWorthSplit';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

const { cashRows, fromMock } = vi.hoisted(() => ({
  cashRows: [] as Array<{ family_member_id: string; liquid_cash: number; vault_cash: number; pf_balance: number; credit_card_debt: number }>,
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

function txn(overrides: Partial<Transaction> & { type: 'BUY' | 'SELL'; quantity: number; date: string; familyMemberId: string }): Transaction {
  return { id: `t-${Math.random()}`, symbol: 'NIFTYBEES.NS', price: 100, ...overrides };
}

function holding(overrides: Partial<DerivedHolding> & { symbol: string; totalQuantity: number; transactions: Transaction[] }): DerivedHolding {
  return { avgPrice: 100, currentPrice: 100, totalInvested: 0, currentValue: 0, pnl: 0, pnlPercent: 0, ...overrides };
}

describe('useFamilyNetWorthSplit', () => {
  beforeEach(() => {
    fromMock.mockReset().mockImplementation((table: string) => {
      if (table === 'cash_settings') {
        return { select: () => Promise.resolve({ data: cashRows, error: null }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    });
  });

  it('never queries when disabled (an individual member view)', async () => {
    // A stable `holdings` reference matters here: the real caller (Index.tsx) always passes
    // usePortfolio()'s memoized `holdings`, never a fresh array literal per render — passing an
    // inline `[]` here would re-create it on every render the hook's own setState triggers,
    // re-firing the effect (its dependency array includes `holdings`) forever.
    const holdings: DerivedHolding[] = [];
    const { result } = renderHook(() => useFamilyNetWorthSplit(holdings, false));
    expect(result.current.loading).toBe(false);
    expect(result.current.splits).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('computes a live per-member split from holdings + cash_settings when enabled', async () => {
    cashRows.length = 0;
    cashRows.push({ family_member_id: 'akash', liquid_cash: 20000, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 });
    const holdings: DerivedHolding[] = [
      holding({
        symbol: 'NIFTYBEES.NS',
        totalQuantity: 100,
        currentPrice: 100,
        transactions: [txn({ type: 'BUY', quantity: 100, date: '2025-01-01', familyMemberId: 'akash' })],
      }),
    ];

    const { result } = renderHook(() => useFamilyNetWorthSplit(holdings, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.splits).toEqual([
      { familyMemberId: 'akash', holdingsValue: 10000, liquidCash: 20000, vaultCash: 0, pfBalance: 0, creditCardDebt: 0, netWorth: 30000 },
    ]);
  });
});
