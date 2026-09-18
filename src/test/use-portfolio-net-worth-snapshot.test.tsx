// Net worth snapshot recording (including the no-op-write dedupe guard — see
// docs/perf-findings.md#1) used to happen client-side in usePortfolio.ts's recordNetWorthSnapshot,
// which this file tested directly. It now runs inside the record_net_worth_snapshot Postgres
// function, called atomically from within update_cash_settings_tracked (see
// supabase/migrations/20260918110000_add_acid_portfolio_mutation_functions.sql) so the cash write
// and the snapshot insert commit or fail together instead of being two separate round trips.
//
// That means the dedupe/epsilon logic itself (still unit-tested in isolation as pure functions in
// src/test/net-worth-snapshot.test.ts) is no longer exercised by calling usePortfolio from Vitest —
// it runs inside Postgres now, and this repo has no integration test harness against a live
// Postgres/Supabase instance to exercise the SQL function body directly. What's left to verify at
// this layer is that usePortfolio.updateCash hands the RPC the right inputs to snapshot from.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// updateCash requires a specific family member selected (not the combined 'all' view) — stand
// in for the default FamilyMemberProvider with one fixed member, same convention CLAUDE.md
// documents for context/hook consumers (mock the hook directly rather than wrapping a provider).
vi.mock('@/contexts/FamilyMemberContext', () => ({
  useFamilyMemberSelection: () => ({ activeMemberId: 'member-1', setActiveMemberId: vi.fn() }),
}));

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(() => Promise.resolve({ data: [{ total_income: 0, total_expense: 0 }], error: null })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({
            order: () => ({
              eq: () => Promise.resolve({
                data: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 }],
              error: null,
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
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    rpc: rpcMock,
  },
}));

describe('usePortfolio updateCash net worth snapshot inputs', () => {
  beforeEach(() => {
    rpcMock.mockClear();
  });

  it('passes the active member and the fully-resolved cash figures to update_cash_settings_tracked', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1000 });
    });

    // liquidCash is the only field the caller changed — vault/pf/creditCardDebt fall back to the
    // current `cash` state, same as the dbRow-construction fallback in usePortfolio.ts's
    // updateCash, so the RPC (and the snapshot it takes inside Postgres) sees a complete row.
    expect(rpcMock).toHaveBeenCalledWith('update_cash_settings_tracked', expect.objectContaining({
      p_family_member_id: 'member-1',
      p_liquid_cash: 1000,
      p_vault_cash: 0,
      p_pf_balance: 0,
      p_credit_card_debt: 0,
      p_exclude_from_cashflow: false,
    }));
  });

  it('sets p_exclude_from_cashflow when the caller opts out', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 5000 }, { excludeFromCashflow: true });
    });

    expect(rpcMock).toHaveBeenCalledWith('update_cash_settings_tracked', expect.objectContaining({
      p_exclude_from_cashflow: true,
    }));
  });
});
