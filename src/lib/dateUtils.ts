/**
 * Shared helper for parsing DATE-only strings the way the rest of this app builds
 * point-in-time Dates — as LOCAL midnight, not UTC midnight.
 *
 * Several Supabase columns are Postgres `date` (no time component): transactions.date,
 * historical_prices.date, benchmark_history.date. When the client reads one of these as
 * a plain 'YYYY-MM-DD' string and does `new Date(dateString)`, JavaScript parses it per
 * the ISO-8601 spec as UTC midnight. Everywhere else in this app, a point-in-time Date is
 * built as LOCAL midnight (`new Date(y, m, d)`, `new Date()` "now", FY boundaries in
 * periodReports.ts, etc).
 *
 * In any timezone ahead of UTC (e.g. IST, UTC+5:30) those two constructions of "the same
 * calendar day" are NOT the same instant — UTC midnight is later in the day than local
 * midnight. Comparing a `new Date(dateString)`-parsed value against a locally-built Date
 * with `<=`/`<`/`>=` can silently drop or misclassify a row whose date exactly matches the
 * comparison boundary (verified against periodReports.ts's price/period-boundary lookups).
 *
 * Use `parseLocalDate` whenever a DATE-only string needs to be compared against, or
 * treated as, a local point-in-time Date — it parses the Y/M/D components directly and
 * builds local midnight, matching every other Date construction in this codebase.
 */
export function parseLocalDate(dateStr: string): Date {
  // A bare 'YYYY-MM-DD' string, with no time-of-day or offset — the exact shape a
  // Postgres DATE column returns. Parse the components directly as LOCAL midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Anything else already carries its own real time-of-day/offset (a full timestamp) —
  // trust the standard parser rather than reinterpreting part of it as a local date.
  return new Date(dateStr);
}

/**
 * Today's calendar date as a bare 'YYYY-MM-DD' string, in the LOCAL timezone — the same
 * shape `transactions.date` (and this app's own `t.date.split('T')[0]` timeline keys, e.g.
 * PortfolioCharts.tsx) already use.
 *
 * NOT the same as `new Date().toISOString().split('T')[0]`, which gives the *UTC* calendar
 * date. In a timezone ahead of UTC (e.g. IST, UTC+5:30), the UTC calendar date is still
 * "yesterday" for the first few hours after local midnight (00:00–05:29 IST) — comparing
 * that against a locally-dated transaction key would misjudge whether today already has a
 * data point.
 */
export function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
