// Pins the memoization boundary that TODO.md's "Memoize XIRR calculations"
// performance item is actually about: `calculateXIRR` used to be computed
// inline in usePortfolio's `summary` memo, whose dependency array includes
// `cash` — so editing a bank balance re-ran Newton-Raphson over the entire
// transaction history even though no cash figure appears anywhere in the
// cash flows. The same held for the two full `buildBreakdown` passes behind
// `exposure`.
//
// These assertions are about *when* work re-runs, not what it returns
// (summary.xirrExPf's values are covered in use-portfolio-xirr-ex-pf.test.tsx),
// so calculateXIRR is spied on while keeping its real implementation — a
// mocked-out return value would make the call counts meaningless.
//
// Follows the same supabase-mocking pattern as
// use-portfolio-cashflow-tracking.test.tsx.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';
import { calculateXIRR } from '@/lib/xirr';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/xirr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xirr')>();
  return { ...actual, calculateXIRR: vi.fn(actual.calculateXIRR) };
});

const { cashState, transactionRows, priceRows, metadataRows } = vi.hoisted(() => ({
  cashState: { liquid_cash: 1000, vault_cash: 2000, pf_balance: 0, credit_card_debt: 0 },
  transactionRows: [
    { id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2024-01-01' },
    { id: '2', symbol: 'INFY', type: 'BUY', quantity: 5, price: 200, date: '2024-06-01' },
  ],
  priceRows: [
    { symbol: 'TCS', price: 150 },
    { symbol: 'INFY', price: 240 },
  ],
  metadataRows: [
    { symbol: 'TCS', geography: 'India', sector: 'IT' },
    { symbol: 'INFY', geography: 'India', sector: 'IT' },
  ],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return { select: () => ({ order: () => Promise.resolve({ data: transactionRows, error: null }) }) };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({ limit: () => ({ single: () => Promise.resolve({ data: cashState, error: null }) }) }),
          update: () => ({ not: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === 'current_prices') {
        return {
          select: () => Promise.resolve({ data: priceRows, error: null }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: metadataRows, error: null }) };
      }
      if (table === 'net_worth_history') {
        return {
          select: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
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

const xirrSpy = vi.mocked(calculateXIRR);

describe('usePortfolio XIRR / exposure memoization', () => {
  beforeEach(() => {
    xirrSpy.mockClear();
  });

  it('does not re-run calculateXIRR when only a cash balance changes', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.summary.xirr).not.toBeNull());

    const callsAfterLoad = xirrSpy.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);
    const xirrBefore = result.current.summary.xirr;

    await act(async () => {
      await result.current.updateCash({ liquidCash: 9000 });
    });

    // The cash edit genuinely landed and the hook re-rendered...
    expect(result.current.summary.liquidCash).toBe(9000);
    expect(result.current.summary.totalPortfolioValue).toBe(
      result.current.summary.currentValue + 9000 + 2000,
    );
    // ...but Newton-Raphson was not re-run, and the figure is unchanged
    // because none of its inputs moved.
    expect(xirrSpy.mock.calls.length).toBe(callsAfterLoad);
    expect(result.current.summary.xirr).toBe(xirrBefore);
  });

  it('keeps the exposure breakdown object identical across a cash change that does not affect it', async () => {
    // pf_balance is 0 and the two cash figures below stay 0-neutral to the
    // *geography* grouping only in the sense that they're folded in as one
    // 'India' aggregate — so the holdings-side grouping is what must be
    // reused. A changed cash value still has to produce new percentages,
    // which the next assertions check.
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const categoryBefore = result.current.exposure.category;
    const itBefore = categoryBefore.find((e) => e.label === 'IT')?.value;
    const cashBefore = categoryBefore.find((e) => e.label === 'Cash')?.value;
    expect(itBefore).toBeGreaterThan(0);
    expect(cashBefore).toBe(3000); // 1000 liquid + 2000 vault

    await act(async () => {
      await result.current.updateCash({ liquidCash: 4000 });
    });

    const categoryAfter = result.current.exposure.category;
    // The holdings-derived slice is byte-for-byte the same number (the
    // memoized single pass was reused, not recomputed)...
    expect(categoryAfter.find((e) => e.label === 'IT')?.value).toBe(itBefore);
    // ...while the cash slice and therefore every percentage did update.
    expect(categoryAfter.find((e) => e.label === 'Cash')?.value).toBe(6000);
    const itPercentBefore = categoryBefore.find((e) => e.label === 'IT')!.percent;
    const itPercentAfter = categoryAfter.find((e) => e.label === 'IT')!.percent;
    expect(itPercentAfter).toBeLessThan(itPercentBefore);
  });

  it('does not double-count cash into the memoized holdings groups across repeated cash edits', async () => {
    // Regression guard for the one hazard the exposure split introduces: the
    // shared `exposureGroups` memo is reused across renders, so folding cash
    // into it in place (rather than into a copy) would accumulate on every
    // subsequent cash-only recompute.
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCash({ liquidCash: 1000 }); // unchanged value
    });
    await act(async () => {
      await result.current.updateCash({ vaultCash: 2000 }); // unchanged value
    });
    await act(async () => {
      await result.current.updateCash({ liquidCash: 1000 });
    });

    // Still exactly 1000 + 2000 after three passes, not a growing total.
    expect(result.current.exposure.category.find((e) => e.label === 'Cash')?.value).toBe(3000);
    const geographyIndia = result.current.exposure.geography.find((e) => e.label === 'India')?.value;
    expect(geographyIndia).toBe(result.current.summary.currentValue + 3000);
  });

  it('does re-run calculateXIRR when a price changes, since the terminal cash flow moved', async () => {
    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.summary.xirr).not.toBeNull());

    const callsAfterLoad = xirrSpy.mock.calls.length;

    await act(async () => {
      await result.current.updatePrice('TCS', 400);
    });

    // The whole point of not caching on a transaction-set hash alone: current
    // prices feed the terminal flow, so this recompute is required.
    expect(xirrSpy.mock.calls.length).toBeGreaterThan(callsAfterLoad);
  });
});
