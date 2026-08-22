// Covers usePortfolio's recordNetWorthSnapshot no-op-write guard (see
// docs/perf-findings.md#1): saving cash settings should insert a fresh
// net_worth_history row only when the computed figures actually differ from
// today's most recent snapshot. The diff logic itself is unit-tested in
// src/test/net-worth-snapshot.test.ts.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type SnapshotRow = {
  net_worth: number; portfolio_value: number; liquid_cash: number; vault_cash: number;
  pf_balance: number; credit_card_debt: number; recorded_at: string;
};

const { transactionRows, snapshotState, insertMock } = vi.hoisted(() => ({
  transactionRows: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }] as Array<{
    id: string; symbol: string; type: string; quantity: number; price: number; date: string;
  }>,
  snapshotState: { row: null } as { row: null | Record<string, unknown> },
  insertMock: vi.fn(() => Promise.resolve({ data: null, error: null })),
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
          update: () => ({ not: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: [{ symbol: 'TCS', price: 250 }], error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === 'net_worth_history') {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: snapshotState.row, error: null }),
              }),
            }),
          }),
          insert: insertMock,
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

function setLatestSnapshot(row: SnapshotRow | null) {
  snapshotState.row = row;
}

describe('usePortfolio recordNetWorthSnapshot', () => {
  beforeEach(() => {
    insertMock.mockClear();
    setLatestSnapshot(null);
  });

  it('inserts a snapshot when there is no prior snapshot from today', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1000 });
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('skips the insert when today\'s figures are unchanged from the most recent snapshot', async () => {
    // TCS: 10 qty * 250 price = 2500 portfolio value; the cash update below
    // re-saves the exact same (all-zero) cash figures already reflected in
    // the latest snapshot, so net worth doesn't move.
    setLatestSnapshot({
      net_worth: 2500,
      portfolio_value: 2500,
      liquid_cash: 0,
      vault_cash: 0,
      pf_balance: 0,
      credit_card_debt: 0,
      recorded_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
    });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('inserts when the figures genuinely changed, even with a snapshot already recorded today', async () => {
    setLatestSnapshot({
      net_worth: 2500,
      portfolio_value: 2500,
      liquid_cash: 0,
      vault_cash: 0,
      pf_balance: 0,
      credit_card_debt: 0,
      recorded_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 500 });
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('inserts a new snapshot for today even if unchanged from a stale snapshot recorded on a previous day', async () => {
    setLatestSnapshot({
      net_worth: 2500,
      portfolio_value: 2500,
      liquid_cash: 0,
      vault_cash: 0,
      pf_balance: 0,
      credit_card_debt: 0,
      recorded_at: '2020-01-01T00:00:00.000Z',
    });

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
