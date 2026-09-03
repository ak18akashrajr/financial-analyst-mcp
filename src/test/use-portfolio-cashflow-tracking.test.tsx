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
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { cashState, cashflowState, upsertMock } = vi.hoisted(() => ({
  cashState: { liquid_cash: 1000, vault_cash: 2000, pf_balance: 0, credit_card_debt: 500 },
  cashflowState: { row: null as null | { total_income: number; total_expense: number } },
  upsertMock: vi.fn((row: any) => {
    cashflowState.row = { total_income: row.total_income, total_expense: row.total_expense };
    return Promise.resolve({ data: null, error: null });
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({ limit: () => ({ single: () => Promise.resolve({ data: cashState, error: null }) }) }),
          update: () => ({ not: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'net_worth_history') {
        return {
          select: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      if (table === 'monthly_cashflow') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: cashflowState.row, error: null }) }) }),
          upsert: upsertMock,
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

describe('usePortfolio income/expense tracking', () => {
  beforeEach(() => {
    upsertMock.mockClear();
    cashflowState.row = null;
  });

  it('tracks a liquidCash increase as income', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1500 }); // +500
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
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

    expect(upsertMock).not.toHaveBeenCalled();
    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });

  it('does not track a credit-card-debt change', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ creditCardDebt: 300 });
    });

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('honors excludeFromCashflow for a manual correction/transfer', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 5000 }, { excludeFromCashflow: true }); // +4000, excluded
    });

    expect(upsertMock).not.toHaveBeenCalled();
    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 0 });
  });

  it('payCreditCardBill settles the debt and counts the Cash Reserve deduction as an expense', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.payCreditCardBill(); // vaultCash 2000 -> 1500, creditCardDebt 500 -> 0
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(result.current.monthlyCashflow).toEqual({ totalIncome: 0, totalExpense: 500 });
  });
});
