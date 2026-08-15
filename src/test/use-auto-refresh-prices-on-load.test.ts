// Covers the one-shot auto-refresh that replaced "prices stay stale until
// you manually click Prices": fires fetchLivePrices exactly once, only
// after loading finishes and there's at least one holding, and never
// refires on later re-renders (including when fetchLivePrices itself is a
// new function reference, which happens on every price update).
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoRefreshPricesOnLoad } from '@/hooks/useAutoRefreshPricesOnLoad';

describe('useAutoRefreshPricesOnLoad', () => {
  it('does not fetch while still loading', () => {
    const fetchLivePrices = vi.fn();
    renderHook(() => useAutoRefreshPricesOnLoad(true, 3, fetchLivePrices));
    expect(fetchLivePrices).not.toHaveBeenCalled();
  });

  it('does not fetch once loaded if there are no holdings', () => {
    const fetchLivePrices = vi.fn();
    renderHook(() => useAutoRefreshPricesOnLoad(false, 0, fetchLivePrices));
    expect(fetchLivePrices).not.toHaveBeenCalled();
  });

  it('fetches once loading finishes with at least one holding', () => {
    const fetchLivePrices = vi.fn();
    const { rerender } = renderHook(
      ({ loading, count }) => useAutoRefreshPricesOnLoad(loading, count, fetchLivePrices),
      { initialProps: { loading: true, count: 0 } },
    );
    expect(fetchLivePrices).not.toHaveBeenCalled();

    rerender({ loading: false, count: 5 });
    expect(fetchLivePrices).toHaveBeenCalledTimes(1);
  });

  it('never refires on later re-renders, even with a new fetchLivePrices reference', () => {
    const fetchLivePrices1 = vi.fn();
    const { rerender } = renderHook(
      ({ count, fn }) => useAutoRefreshPricesOnLoad(false, count, fn),
      { initialProps: { count: 5, fn: fetchLivePrices1 } },
    );
    expect(fetchLivePrices1).toHaveBeenCalledTimes(1);

    // Simulate fetchLivePrices being recreated (it depends on currentPrices,
    // which changes as a result of the very fetch this hook triggered) and
    // holdings count changing again — should still never refire.
    const fetchLivePrices2 = vi.fn();
    rerender({ count: 6, fn: fetchLivePrices2 });
    rerender({ count: 0, fn: fetchLivePrices2 });

    expect(fetchLivePrices2).not.toHaveBeenCalled();
  });
});
