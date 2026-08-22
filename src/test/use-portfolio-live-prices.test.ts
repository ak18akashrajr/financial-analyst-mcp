// Covers usePortfolio's fetchLivePrices path against fetch-prices' new
// changed/unchanged response shape (see docs/scaling-and-archival-plan.md's
// addendum: fetch-prices now skips writing a price that hasn't moved). This
// tests the hook's own bookkeeping (lastPriceCheckTime always bumps,
// lastPriceChangeTime only bumps on a real change, toast wording reflects
// what actually happened) — the underlying diff logic itself is unit-tested
// in supabase/functions/_shared/price-diff.test.ts.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { transactionRows, currentPriceRows, invokeMock } = vi.hoisted(() => ({
  transactionRows: [{ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }] as Array<{
    id: string; symbol: string; type: string; quantity: number; price: number; date: string;
  }>,
  currentPriceRows: [] as Array<{ symbol: string; price: number; updated_at?: string }>,
  invokeMock: vi.fn(),
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
        return { select: () => Promise.resolve({ data: currentPriceRows, error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    functions: { invoke: invokeMock },
  },
}));

import { toast } from 'sonner';

describe('usePortfolio.fetchLivePrices', () => {
  beforeEach(() => {
    currentPriceRows.length = 0;
    currentPriceRows.push({ symbol: 'TCS', price: 250, updated_at: '2026-08-01T10:00:00.000Z' });
    invokeMock.mockReset();
    vi.mocked(toast.success).mockClear();
  });

  it('derives an initial lastPriceChangeTime from current_prices.updated_at on load', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastPriceChangeTime).not.toBeNull();
    expect(result.current.lastPriceCheckTime).toBeNull();
  });

  it('bumps lastPriceCheckTime but not lastPriceChangeTime when nothing actually changed', async () => {
    invokeMock.mockResolvedValue({ data: { prices: { TCS: 250 }, changed: [], unchanged: ['TCS'] }, error: null });
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const changeTimeBefore = result.current.lastPriceChangeTime;

    await act(async () => {
      await result.current.fetchLivePrices();
    });

    expect(result.current.lastPriceCheckTime).not.toBeNull();
    expect(result.current.lastPriceChangeTime).toBe(changeTimeBefore);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/no change, nothing written/));
  });

  it('bumps both timestamps and reports mixed results when some prices changed', async () => {
    invokeMock.mockResolvedValue({
      data: { prices: { TCS: 260, INFY: 1500 }, changed: ['TCS'], unchanged: ['INFY'] },
      error: null,
    });
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchLivePrices();
    });

    expect(result.current.lastPriceCheckTime).not.toBeNull();
    expect(result.current.lastPriceChangeTime).not.toBeNull();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Updated 1 price\(s\), 1 unchanged/));
  });

  it('reports a clean "all updated" message when every checked price changed', async () => {
    invokeMock.mockResolvedValue({ data: { prices: { TCS: 260 }, changed: ['TCS'], unchanged: [] }, error: null });
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchLivePrices();
    });

    expect(toast.success).toHaveBeenCalledWith('Updated 1 price(s) from Yahoo Finance');
  });
});
