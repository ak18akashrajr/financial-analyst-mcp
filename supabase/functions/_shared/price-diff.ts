// Decides which freshly-fetched prices are actually worth writing to
// current_prices, so fetch-prices stops rewriting every row on every
// homepage load regardless of whether the price moved. See
// docs/scaling-and-archival-plan.md's addendum for why this matters: the
// table's `updated_at` trigger bumps on every UPDATE, so an unconditional
// upsert of N symbols on every visit is N no-op writes/day forever — real
// MVCC churn (new tuple + dead tuple to vacuum + a WAL entry) for a table
// whose row count never actually grows.
//
// Pure and DB-free on purpose so this is unit-testable without a live
// Supabase connection — same rationale as _shared/mcp-schema-validate.ts.

export interface PriceDiff {
  /** Symbol → price, for exactly the rows worth upserting. */
  toWrite: Record<string, number>;
  changed: string[];
  unchanged: string[];
}

// Prices are stored as NUMERIC and sourced from Yahoo Finance's floating-point
// JSON — sub-paisa/sub-cent differences are float noise, not a real price
// move. Anything below this is treated as unchanged.
export const PRICE_CHANGE_EPSILON = 0.005;

/**
 * `fetched` is every symbol this call got a non-null price for; `existing` is
 * whatever's currently stored for those same symbols (missing entries mean a
 * brand-new symbol, always written). Comparison is a plain absolute
 * difference against PRICE_CHANGE_EPSILON — good enough for equity/ETF price
 * scales; not intended for assets priced in fractions of a paisa/cent.
 */
export function selectPricesToWrite(
  fetched: Record<string, number>,
  existing: Record<string, number>,
): PriceDiff {
  const toWrite: Record<string, number> = {};
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [symbol, price] of Object.entries(fetched)) {
    const previous = existing[symbol];
    const isNewSymbol = previous === undefined;
    const hasMoved = isNewSymbol || Math.abs(price - previous) > PRICE_CHANGE_EPSILON;

    if (hasMoved) {
      toWrite[symbol] = price;
      changed.push(symbol);
    } else {
      unchanged.push(symbol);
    }
  }

  return { toWrite, changed, unchanged };
}
