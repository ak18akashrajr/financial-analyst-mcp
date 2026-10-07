// Covers usePortfolio's income/expense intelligence layered on cash_settings
// balance updates (see TODO.md "Expense to Income Ratio" and
// src/lib/expenseIncomeRatio.ts): an Operating Cash / Cash Reserve increase
// is tracked as income, a decrease as an expense, unless the caller opts out
// via excludeFromCashflow — which the bulk data reset does, but
// payCreditCardBill deliberately does not (the Cash Reserve deduction at
// settlement is the only point a card bill's spend is ever visible to the
// ratio, since charging the card is never tracked). Follows the same
// supabase-mocking pattern as use-portfolio-net-worth-snapshot.test.tsx.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// updateCash/resetAll require a specific family member selected (not the combined 'all' view) —
// stand in for the default FamilyMemberProvider with one fixed member by default, same convention
// CLAUDE.md documents for context/hook consumers (mock the hook directly rather than wrapping a
// provider). `memberState.activeMemberId` is switchable so a test can exercise the 'all' view.
const { memberState } = vi.hoisted(() => ({ memberState: { activeMemberId: 'member-1' } }));
vi.mock('@/contexts/FamilyMemberContext', () => ({
  useFamilyMemberSelection: () => ({ activeMemberId: memberState.activeMemberId, setActiveMemberId: vi.fn() }),
}));

// updateCash and resetAll now run as single atomic RPCs (see
// supabase/migrations/20260918110000_add_acid_portfolio_mutation_functions.sql) instead of a
// client-driven upsert/delete sequence, so this mock's `rpc` implements the same income/expense
// accumulation that update_cash_settings_tracked does server-side (compare previous vault/liquid
// cash to the new values, classify the delta, accumulate into the month's running total) — that
// SQL logic itself isn't exercised by this test file; it can only run against a real Postgres.
const { cashState, cashflowState, rpcFailure, rpcMock } = vi.hoisted(() => ({
  cashState: { liquid_cash: 1000, vault_cash: 2000, pf_balance: 0, credit_card_debt: 500 },
  cashflowState: { totalIncome: 0, totalExpense: 0 },
  rpcFailure: { updateCash: false },
  rpcMock: vi.fn((fn: string, args: any) => {
    if (fn === 'update_cash_settings_tracked') {
      if (rpcFailure.updateCash) return Promise.resolve({ data: null, error: { message: 'boom' } });
      if (!args.p_exclude_from_cashflow) {
        const deltaLiquid = args.p_liquid_cash - cashState.liquid_cash;
        const deltaVault = args.p_vault_cash - cashState.vault_cash;
        for (const delta of [deltaLiquid, deltaVault]) {
          if (delta > 0) cashflowState.totalIncome += delta;
          else if (delta < 0) cashflowState.totalExpense += -delta;
        }
      }
      cashState.liquid_cash = args.p_liquid_cash;
      cashState.vault_cash = args.p_vault_cash;
      cashState.pf_balance = args.p_pf_balance;
      cashState.credit_card_debt = args.p_credit_card_debt;
      return Promise.resolve({ data: [{ total_income: cashflowState.totalIncome, total_expense: cashflowState.totalExpense }], error: null });
    }
    if (fn === 'reset_all_data') {
      cashflowState.totalIncome = 0;
      cashflowState.totalExpense = 0;
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        // transactions are read via fetchAllPages: .order().order()[.eq()].range(from, to).
        return {
          select: () => ({
            order: () => ({
              order: () => {
                const q: any = {
                  eq: () => q,
                  range: (from: number, to: number) => Promise.resolve({ data: [] as unknown[], error: null }),
                };
                return q;
              },
            }),
          }),
        };
      }
      if (table === 'cash_settings') {
        // Awaitable with or without .eq(): the 'all' view queries every member's row unfiltered.
        return {
          select: () => {
            const q: any = Promise.resolve({ data: [cashState], error: null });
            q.eq = () => q;
            return q;
          },
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'monthly_cashflow') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    rpc: rpcMock,
  },
}));

describe('usePortfolio income/expense tracking', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    memberState.activeMemberId = 'member-1';
    rpcFailure.updateCash = false;
    cashState.liquid_cash = 1000;
    cashState.vault_cash = 2000;
    cashState.pf_balance = 0;
    cashState.credit_card_debt = 500;
    cashflowState.totalIncome = 0;
    cashflowState.totalExpense = 0;
  });

  it('tracks a liquidCash increase as income', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1500 }); // +500
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 500, totalExpense: 0 });
  });

  it('tracks a vaultCash decrease as an expense', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ vaultCash: 1200 }); // -800
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 800 });
  });

  it('accumulates across multiple updates within the same month', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1500 }); // +500 income
    });
    await act(async () => {
      await result.current.updateCash({ liquidCash: 1300 }); // -200 expense
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 500, totalExpense: 200 });
  });

  it('does not track a PF balance change', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ pfBalance: 50000 });
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });

  it('does not track a credit-card-debt change', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ creditCardDebt: 300 });
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });

  it('honors excludeFromCashflow for a manual correction/transfer', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 5000 }, { excludeFromCashflow: true }); // +4000, excluded
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });

  it('payCreditCardBill settles the debt and counts the Cash Reserve deduction as an expense', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.payCreditCardBill(); // vaultCash 2000 -> 1500, creditCardDebt 500 -> 0
    });

    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 500 });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("payCreditCardBill doesn't claim success in the combined 'All Family' view", async () => {
    memberState.activeMemberId = 'all';
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.payCreditCardBill();
    });

    expect(rpcMock).not.toHaveBeenCalledWith('update_cash_settings_tracked', expect.anything());
    expect(toast.error).toHaveBeenCalledWith('Select a specific family member before editing cash balances');
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.cash.creditCardDebt).toBe(500);
  });

  it("payCreditCardBill doesn't claim success when the cash update fails", async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));
    rpcFailure.updateCash = true;

    await act(async () => {
      await result.current.payCreditCardBill();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to update cash');
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.cash.creditCardDebt).toBe(500);
    expect(result.current.cash.vaultCash).toBe(2000);
  });

  it('resetAll clears monthly_cashflow along with everything else', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ vaultCash: 1200 }); // -800 expense, so there's something to clear
    });
    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 800 });

    await act(async () => {
      await result.current.resetAll();
    });

    expect(rpcMock).toHaveBeenCalledWith('reset_all_data');
    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });
});
