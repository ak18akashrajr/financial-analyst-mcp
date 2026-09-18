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

// addTransaction/updateCash/resetAll require a specific family member selected (not the combined
// 'all' view) — stand in for the default FamilyMemberProvider with one fixed member, same
// convention CLAUDE.md documents for context/hook consumers (mock the hook directly).
vi.mock('@/contexts/FamilyMemberContext', () => ({
  useFamilyMemberSelection: () => ({ activeMemberId: 'member-1', setActiveMemberId: vi.fn() }),
}));

const { insertError, updateError, deleteErrors } = vi.hoisted(() => ({
  insertError: { value: null as { message: string } | null },
  updateError: { value: null as { message: string } | null },
  deleteErrors: { value: null as { message: string } | null },
}));

// addTransaction/updateCash/resetAll each now run as a single atomic RPC (see
// supabase/migrations/20260918110000_add_acid_portfolio_mutation_functions.sql) instead of a
// separate insert/upsert/delete call, so the injectable failures below are simulated at the rpc
// mock level instead of on individual `.from(table)` chains.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return { select: () => ({ order: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 }], error: null }),
          }),
        };
      }
      if (table === 'current_prices') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === 'symbol_metadata') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === 'monthly_cashflow') return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    rpc: (fn: string) => {
      if (fn === 'add_transaction_and_snapshot') {
        return Promise.resolve(
          insertError.value
            ? { data: null, error: insertError.value }
            : { data: { id: 't1', symbol: 'TCS', type: 'BUY', quantity: 1, price: 100, date: '2026-01-01', family_member_id: 'member-1' }, error: null },
        );
      }
      if (fn === 'update_cash_settings_tracked') {
        return Promise.resolve(
          updateError.value
            ? { data: null, error: updateError.value }
            : { data: [{ total_income: 0, total_expense: 0 }], error: null },
        );
      }
      if (fn === 'reset_all_data') {
        return Promise.resolve({ data: null, error: deleteErrors.value });
      }
      return Promise.resolve({ data: null, error: null });
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

  it('calls logClientError when resetAll fails', async () => {
    // resetAll now runs as one atomic reset_all_data RPC (see
    // supabase/migrations/20260918110000_...) rather than four independent per-table deletes, so
    // there's no longer a per-table error breakdown to assert on — a failure is just one error
    // from the single call.
    deleteErrors.value = { message: 'connection reset' };
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.resetAll();
    });

    expect(logClientErrorMock).toHaveBeenCalledWith(
      'usePortfolio.resetAll',
      'Failed to reset data',
      expect.objectContaining({ error: deleteErrors.value }),
    );
  });
});
