// Decides whether a freshly-computed net worth snapshot is worth inserting
// into net_worth_history, so recordNetWorthSnapshot stops adding a new row
// on every transaction/cash edit regardless of whether the number actually
// moved. See docs/perf-findings.md#1 and _shared/price-diff.ts's
// selectPricesToWrite for the same shape applied to current_prices.
//
// Pure and DB-free on purpose so this is unit-testable without a live
// Supabase connection.

export interface NetWorthSnapshotFields {
  netWorth: number;
  portfolioValue: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
}

// All fields are rupee amounts pulled from NUMERIC columns / floating-point
// arithmetic — anything below this is float noise, not a real change.
export const NET_WORTH_CHANGE_EPSILON = 0.01;

/**
 * `mostRecentToday` should be the latest net_worth_history row, already
 * filtered by the caller to today's calendar day (or `null` if there isn't
 * one yet) — a snapshot from a previous day never blocks today's first
 * insert, matching the "one snapshot per day (at most)" growth model in
 * docs/scaling-and-archival-plan.md.
 */
export function shouldSkipNetWorthSnapshot(
  candidate: NetWorthSnapshotFields,
  mostRecentToday: NetWorthSnapshotFields | null,
): boolean {
  if (!mostRecentToday) return false;

  return (Object.keys(candidate) as (keyof NetWorthSnapshotFields)[]).every(
    (key) => Math.abs(candidate[key] - mostRecentToday[key]) <= NET_WORTH_CHANGE_EPSILON,
  );
}

/** Calendar-day equality in IST — the app's display timezone (see usePortfolio.ts's formatIstTimestamp). */
export function isSameIstCalendarDay(a: Date, b: Date): boolean {
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  return fmt(a) === fmt(b);
}
