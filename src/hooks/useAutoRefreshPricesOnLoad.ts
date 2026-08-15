import { useEffect, useRef } from 'react';

/**
 * Fires `fetchLivePrices` exactly once — the first time `loading` turns
 * false with at least one holding present — so the dashboard shows current
 * market prices on first load instead of whatever was last written to the
 * `current_prices` table by a previous manual refresh.
 *
 * Deliberately a one-shot: `fetchLivePrices` itself is recreated whenever
 * `currentPrices` updates (see usePortfolio), so without the ref guard this
 * effect would refire after every fetch it triggers.
 */
export function useAutoRefreshPricesOnLoad(
  loading: boolean,
  holdingsCount: number,
  fetchLivePrices: () => void | Promise<void>,
) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (loading || holdingsCount === 0) return;
    firedRef.current = true;
    fetchLivePrices();
  }, [loading, holdingsCount, fetchLivePrices]);
}
