/**
 * Builds the portfolio's historical mark-to-market value series and the flow-adjusted return
 * series derived from it — the input every forecast in src/lib/forecast.ts is fitted on.
 *
 * Nothing in this app stored such a series before this module: `net_worth_history` is written
 * only as a side effect of transaction/cash mutations (usePortfolio.ts `recordNetWorthSnapshot`),
 * so it is an irregular event log, not a grid. `PortfolioCharts.tsx`'s `timelineData` looks like
 * a value history but marks every past point at *today's* price, so it is not a mark-to-market
 * series either. This rebuilds the series properly from `transactions` × `historical_prices` —
 * the same per-date logic `getPortfolioValueAsOf` in
 * supabase/functions/_shared/portfolio-data.ts already applies to a single date, looped over a
 * grid of dates instead.
 *
 * Three deliberate choices, each of which the correctness of the forecast depends on:
 *
 * 1. EQUITY ONLY, NOT NET WORTH. Cash/PF/credit-card-debt live in the sparse, event-driven
 *    `net_worth_history`; forward-filling them onto a grid injects step changes on edit days
 *    straight into the fitted volatility. Only the market-driven holdings value is modelled here.
 *    Callers add cash back as a deterministic, non-stochastic offset.
 *
 * 2. RETURNS ARE FLOW-ADJUSTED. A ₹1L BUY raises portfolio value without being a market return,
 *    so a naive (V_t − V_t−1)/V_t−1 would read every SIP day as a large gain and bias the fitted
 *    drift badly upward. `flowAdjustedReturns` uses the daily modified-Dietz form instead —
 *    see its doc comment.
 *
 * 3. THE GRID IS TRADING DAYS, NOT CALENDAR DAYS. The date grid is the union of the dates that
 *    actually have `historical_prices` rows. A calendar grid would forward-fill weekends into
 *    ~30% zero returns, deflating the sample standard deviation while still being annualized by
 *    √252 — i.e. a systematically understated volatility.
 */

/** One `historical_prices` row, narrowed to what this module needs. Ascending order not required. */
export interface PriceBar {
  date: string;
  close: number;
}

export type PricesBySymbol = Record<string, PriceBar[]>;

/** The subset of `Transaction` (src/types/portfolio.ts) this module reads. */
export interface SeriesTransaction {
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  date: string;
}

export interface ValuePoint {
  /** Grid date, `YYYY-MM-DD`. */
  date: string;
  /** Mark-to-market value of holdings on this date (holdings only — no cash, PF or debt). */
  value: number;
  /**
   * Net money moved in on this date: BUY value − SELL value, covering every transaction since
   * the previous grid date (so a Saturday buy is attributed to Monday's bar, where its value
   * first shows up). Subtracted out by `flowAdjustedReturns`.
   */
  netFlow: number;
  /**
   * True when every symbol held on this date had a price available. A false point is excluded
   * from the return series at both ends: when a symbol's price history starts partway through,
   * `value` jumps by that symbol's entire worth on the day it becomes priceable, which is a data
   * artifact, not a return.
   */
  complete: boolean;
}

export type SeriesGranularity = 'daily' | 'monthly' | 'mixed' | 'unknown';

export interface ValueSeries {
  points: ValuePoint[];
  granularity: SeriesGranularity;
  /** Annualization factor implied by `granularity` — see `periodsPerYear`. */
  periodsPerYear: number;
  /** Symbols held on at least one grid date with no price row on or before it. */
  symbolsWithoutPrices: string[];
  /** Grid dates dropped from the return series because a held symbol was unpriced. */
  incompletePoints: number;
}

export interface BuildSeriesOptions {
  /** Inclusive upper bound for the grid, `YYYY-MM-DD`. Defaults to the latest available price date. */
  endDate?: string;
}

const MIN_QTY = 1e-9;

/**
 * Normalizes a date to `YYYY-MM-DD`.
 *
 * `transactions.date` is a Postgres `timestamptz`, not a `date` — rows come back as full ISO
 * timestamps. That matters: the raw string comparison `t.date <= asOfDate` used elsewhere in this
 * codebase is lexicographic, so `"2026-03-15T10:30:00+00:00" > "2026-03-15"` and a transaction
 * made *on* the boundary date is silently excluded. Truncating to the date prefix first removes
 * that off-by-one here.
 */
function toDayString(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` strings, parsed as UTC midnight so DST can't shift it. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Trading periods per year implied by a grid's spacing — the ×252 / ×12 annualization factor. */
export function periodsPerYear(granularity: SeriesGranularity, medianGapDays = 1): number {
  if (granularity === 'daily') return 252;
  if (granularity === 'monthly') return 12;
  if (granularity === 'mixed' && medianGapDays > 0) return 365 / medianGapDays;
  return 252;
}

/**
 * Classifies a grid's spacing from the median gap between consecutive dates.
 *
 * `historical_prices` holds both granularities under the same `(symbol, date)` key: the Reports
 * page's "Backfill FY" button writes `interval: '1d'` rows while the Rolling Returns page writes
 * `interval: '1mo'` rows. Annualizing monthly observations by √252 instead of √12 would overstate
 * volatility by ~4.6×, so this has to be detected rather than assumed.
 */
export function detectGranularity(dates: string[]): { granularity: SeriesGranularity; medianGapDays: number } {
  if (dates.length < 3) return { granularity: 'unknown', medianGapDays: 0 };
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 4) return { granularity: 'daily', medianGapDays: median };
  if (median >= 20 && median <= 45) return { granularity: 'monthly', medianGapDays: median };
  return { granularity: 'mixed', medianGapDays: median };
}

/**
 * Replays `txns` against `pricesBySymbol` to produce the mark-to-market value of the holdings on
 * every date that has price data, from the first transaction onward.
 *
 * Quantities are net BUY − SELL, matching `computeHoldingsFromTxns` in
 * supabase/functions/_shared/portfolio-data.ts. FIFO (src/lib/costBasis.ts) is deliberately not
 * used: it changes cost basis, not the quantity held, and value here is quantity × price.
 *
 * Prices are last-observation-carried-forward (the newest close on or before the grid date) — the
 * same rule as `fetchPriceMapAsOf`, resolved once with an advancing pointer rather than a binary
 * search per lookup, since the grid is walked in order.
 */
export function buildValueSeries(
  txns: SeriesTransaction[],
  pricesBySymbol: PricesBySymbol,
  opts: BuildSeriesOptions = {},
): ValueSeries {
  const empty: ValueSeries = {
    points: [],
    granularity: 'unknown',
    periodsPerYear: 252,
    symbolsWithoutPrices: [],
    incompletePoints: 0,
  };

  const normalized = txns
    .map((t) => ({
      symbol: t.symbol,
      type: t.type,
      quantity: Number(t.quantity),
      price: Number(t.price),
      date: toDayString(t.date),
    }))
    .filter((t) => t.date !== '' && Number.isFinite(t.quantity) && Number.isFinite(t.price))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (normalized.length === 0) return empty;

  const heldSymbols = [...new Set(normalized.map((t) => t.symbol))];

  const bars: Record<string, PriceBar[]> = {};
  for (const symbol of heldSymbols) {
    bars[symbol] = (pricesBySymbol[symbol] || [])
      .map((b) => ({ date: toDayString(b.date), close: Number(b.close) }))
      .filter((b) => b.date !== '' && Number.isFinite(b.close) && b.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const firstTxnDate = normalized[0].date;
  const endDate = opts.endDate ? toDayString(opts.endDate) : '9999-12-31';

  const gridSet = new Set<string>();
  for (const symbol of heldSymbols) {
    for (const bar of bars[symbol]) {
      if (bar.date >= firstTxnDate && bar.date <= endDate) gridSet.add(bar.date);
    }
  }
  const grid = [...gridSet].sort();
  if (grid.length === 0) return empty;

  const qty: Record<string, number> = {};
  const priceIdx: Record<string, number> = {};
  for (const symbol of heldSymbols) {
    qty[symbol] = 0;
    priceIdx[symbol] = -1;
  }

  const missingEver = new Set<string>();
  const points: ValuePoint[] = [];
  let txnPtr = 0;
  let incompletePoints = 0;

  for (const date of grid) {
    // Every transaction not yet applied whose date has now been reached. Because `txnPtr` only
    // moves forward, this attributes each transaction to the first grid date on or after it —
    // a trade on a non-trading day lands on the next bar, where its value first appears.
    let netFlow = 0;
    while (txnPtr < normalized.length && normalized[txnPtr].date <= date) {
      const t = normalized[txnPtr];
      const signedQty = t.type === 'BUY' ? t.quantity : -t.quantity;
      qty[t.symbol] += signedQty;
      netFlow += signedQty * t.price;
      txnPtr++;
    }

    let value = 0;
    let complete = true;
    for (const symbol of heldSymbols) {
      const arr = bars[symbol];
      while (priceIdx[symbol] + 1 < arr.length && arr[priceIdx[symbol] + 1].date <= date) priceIdx[symbol]++;
      if (qty[symbol] <= MIN_QTY) continue;
      if (priceIdx[symbol] < 0) {
        complete = false;
        missingEver.add(symbol);
        continue;
      }
      value += qty[symbol] * arr[priceIdx[symbol]].close;
    }

    if (!complete) incompletePoints++;
    points.push({ date, value, netFlow, complete });
  }

  const { granularity, medianGapDays } = detectGranularity(grid);

  return {
    points,
    granularity,
    periodsPerYear: periodsPerYear(granularity, medianGapDays),
    symbolsWithoutPrices: [...missingEver].sort(),
    incompletePoints,
  };
}

/**
 * Per-period returns with contributions and withdrawals removed:
 *
 *     r_t = (V_t − V_t−1 − netFlow_t) / V_t−1
 *
 * the daily modified-Dietz approximation of a time-weighted return. Without the `netFlow_t` term
 * every purchase reads as a market gain — a ₹1L buy into a ₹1L portfolio would register as a
 * +100% day — which would dominate the fitted drift and make the forecast meaningless.
 *
 * A pair is skipped when either endpoint is incomplete (an unpriced holding, see
 * `ValuePoint.complete`) or when the starting value is zero or negative, which has no defined
 * return. Skipping a pair does not bridge across it: the series is only ever built from
 * consecutive grid points.
 */
export function flowAdjustedReturns(series: ValueSeries): number[] {
  const out: number[] = [];
  const { points } = series;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev.complete || !cur.complete) continue;
    if (!(prev.value > 0)) continue;
    out.push((cur.value - prev.value - cur.netFlow) / prev.value);
  }
  return out;
}
