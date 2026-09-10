// Confirms usePortfolio's mutation failure branches call logClientError (in
// addition to the existing toast/console.error), so a failed write leaves a
// queryable app_logs trace instead of just a toast the user already
// dismissed by the time anyone goes looking. See clientErrorLogging.ts's
// header comment for why this was added — this file only covers a
// representative sample of call sites (add/update a transaction, update
// cash, and the destructive resetAll), not every single one; the pattern is
// identical everywhere else it's used in usePortfolio.ts.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { logClientErrorMock } = vi.hoisted(() => ({ logClientErrorMock: vi.fn() }));
vi.mock('@/lib/clientErrorLogging', () => ({ logClientError: logClientErrorMock }));

const { insertError, updateError, deleteErrors } = vi.hoisted(() => ({
  insertError: { value: null as { message: string } | null },
  updateError: { value: null as { message: string } | null },
  deleteErrors: { value: null as { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve(
                insertError.value
                  ? { data: null, error: insertError.value }
                  : { data: { id: 't1', symbol: 'TCS', type: 'BUY', quantity: 1, price: 100, date: '2026-01-01' }, error: null },
              ),
            }),
          }),
          delete: () => ({ not: () => Promise.resolve({ error: deleteErrors.value }) }),
        };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({
            limit: () => ({ single: () => Promise.resolve({ data: { liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 }, error: null }) }),
          }),
          update: () => ({ not: () => Promise.resolve({ error: updateError.value }) }),
        };
      }
      if (table === 'current_prices') {
        return {
          select: () => Promise.resolve({ data: [], error: null }),
          delete: () => ({ not: () => Promise.resolve({ error: deleteErrors.value }) }),
        };
      }
      if (table === 'symbol_metadata') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === 'monthly_cashflow') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          upsert: () => Promise.resolve({ error: null }),
          delete: () => ({ not: () => Promise.resolve({ error: deleteErrors.value }) }),
        };
      }
      if (table === 'net_worth_history') {
        return {
          select: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
          insert: () => Promise.resolve({ error: null }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

describe('usePortfolio mutation failures', () => {
  beforeEach(() => {
    logClientErrorMock.mockClear();
    insertError.value = null;
    updateError.value = null;
    deleteErrors.value = null;
  });

  it('calls logClientError when adding a transaction fails', async () => {
    insertError.value = { message: 'constraint violation' };
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addTransaction({ symbol: 'TCS', type: 'BUY', quantity: 1, price: 100 });
    });

    expect(logClientErrorMock).toHaveBeenCalledWith(
      'usePortfolio.addTransaction',
      'Failed to add transaction',
      expect.objectContaining({ error: insertError.value }),
    );
  });

  it('calls logClientError when updating cash_settings fails', async () => {
    updateError.value = { message: 'RLS denied' };
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 500 });
    });

    expect(logClientErrorMock).toHaveBeenCalledWith(
      'usePortfolio.updateCash',
      'Failed to update cash_settings',
      expect.objectContaining({ error: updateError.value }),
    );
  });

  it('does not call logClientError on a successful mutation', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addTransaction({ symbol: 'TCS', type: 'BUY', quantity: 1, price: 100 });
    });

    expect(logClientErrorMock).not.toHaveBeenCalled();
  });

  it('calls logClientError with a per-table error breakdown when resetAll partially fails', async () => {
    deleteErrors.value = { message: 'connection reset' };
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.resetAll();
    });

    expect(logClientErrorMock).toHaveBeenCalledWith(
      'usePortfolio.resetAll',
      'Failed to reset one or more tables',
      expect.objectContaining({
        transactionsError: deleteErrors.value,
        currentPricesError: deleteErrors.value,
        monthlyCashflowError: deleteErrors.value,
      }),
    );
  });
});
