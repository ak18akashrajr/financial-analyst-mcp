/**
 * Picks the smallest Yahoo `range` that still reaches back to the oldest "latest stored bar" among the
 * held symbols, so an auto-refresh on the Charts page fills any gap since the last fetch without
 * re-downloading 2 years of history on every visit.
 *
 * `latestBarBySymbol` maps each held symbol to its newest stored `YYYY-MM-DD` (absent = no bars at all).
 * A symbol with no bars forces the full '2y' (the same range the Reports "Backfill FY" button uses).
 * Gaps in the MIDDLE of stored history can't be seen from the newest date alone and are not repaired
 * by this — only the tail after the lagging symbol's last bar is.
 */
import { daysBetween } from './portfolioSeries';

// Yahoo `range` values, smallest → largest, with the most calendar days each is trusted to cover
// (a bit under the nominal span so a weekend/holiday at the edge can't leave a hole).
const RANGES: { range: string; maxDays: number }[] = [
  { range: '5d', maxDays: 4 },
  { range: '1mo', maxDays: 27 },
  { range: '3mo', maxDays: 85 },
  { range: '6mo', maxDays: 175 },
  { range: '1y', maxDays: 355 },
];

export function pickRefreshRange(symbols: string[], latestBarBySymbol: Record<string, string | undefined>, todayIst: string): string {
  let oldestLatest: string | null = null;
  for (const s of symbols) {
    const d = latestBarBySymbol[s];
    if (!d) return '2y';
    if (oldestLatest == null || d < oldestLatest) oldestLatest = d;
  }
  if (oldestLatest == null) return '2y';
  const gap = Math.max(0, daysBetween(oldestLatest, todayIst));
  return RANGES.find((r) => gap <= r.maxDays)?.range ?? '2y';
}
