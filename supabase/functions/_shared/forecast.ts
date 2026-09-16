// Time series forecasting for the portfolio's total value — the Deno/edge-function counterpart of
// src/lib/portfolioSeries.ts + src/lib/forecast.ts, used by the forecast_portfolio_value MCP tool.
//
// This is a hand-synced mirror, not a shared import, following the precedent already established by
// src/lib/riskMetrics.ts (a frontend mirror of this file's own getRiskMetrics) and
// src/pages/Benchmark.tsx (a frontend mirror of compareToBenchmark): the frontend is a Vite/browser
// bundle and this is Deno edge-function code (`https://esm.sh/...` imports, `Deno.env`), so neither
// side can import the other directly. Keep the two in sync by hand if either changes.
//
// Deliberately a SMALLER surface than src/lib/forecast.ts, to bound the cost of this duplication:
//   - Only the parametric (log-normal GBM) method is ported — no block-bootstrap, no EWMA
//     volatility variant, no walk-forward backtest. Those stay interactive-only, on the Forecast
//     page; a chat answer just needs one well-founded number, not a choice of models.
//   - No injectable RNG — the MCP tool's result is a fresh Monte Carlo draw per call, same as every
//     other simulation-backed tool in this registry would be if one existed.
// See src/lib/forecast.ts's doc comment for why this uses log-normal GBM rather than the
// arithmetic-normal walk in projectionEngine.ts/monteCarloAdvanced.ts.

export interface PriceBar {
  date: string;
  close: number;
}

export type PricesBySymbol = Record<string, PriceBar[]>;

export interface SeriesTransaction {
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  date: string;
}

interface ValuePoint {
  date: string;
  value: number;
  netFlow: number;
  complete: boolean;
}

export type SeriesGranularity = "daily" | "monthly" | "mixed" | "unknown";

export interface ValueSeries {
  points: ValuePoint[];
  granularity: SeriesGranularity;
  periodsPerYear: number;
  symbolsWithoutPrices: string[];
  incompletePoints: number;
}

const MIN_QTY = 1e-9;

function toDayString(value: string): string {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function periodsPerYear(granularity: SeriesGranularity, medianGapDays = 1): number {
  if (granularity === "daily") return 252;
  if (granularity === "monthly") return 12;
  if (granularity === "mixed" && medianGapDays > 0) return 365 / medianGapDays;
  return 252;
}

function detectGranularity(dates: string[]): { granularity: SeriesGranularity; medianGapDays: number } {
  if (dates.length < 3) return { granularity: "unknown", medianGapDays: 0 };
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 4) return { granularity: "daily", medianGapDays: median };
  if (median >= 20 && median <= 45) return { granularity: "monthly", medianGapDays: median };
  return { granularity: "mixed", medianGapDays: median };
}

/** See src/lib/portfolioSeries.ts's `buildValueSeries` for the full doc comment on this algorithm. */
export function buildValueSeries(txns: SeriesTransaction[], pricesBySymbol: PricesBySymbol): ValueSeries {
  const empty: ValueSeries = { points: [], granularity: "unknown", periodsPerYear: 252, symbolsWithoutPrices: [], incompletePoints: 0 };

  const normalized = txns
    .map((t) => ({ symbol: t.symbol, type: t.type, quantity: Number(t.quantity), price: Number(t.price), date: toDayString(t.date) }))
    .filter((t) => t.date !== "" && Number.isFinite(t.quantity) && Number.isFinite(t.price))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (normalized.length === 0) return empty;

  const heldSymbols = [...new Set(normalized.map((t) => t.symbol))];
  const bars: Record<string, PriceBar[]> = {};
  for (const symbol of heldSymbols) {
    bars[symbol] = (pricesBySymbol[symbol] || [])
      .map((b) => ({ date: toDayString(b.date), close: Number(b.close) }))
      .filter((b) => b.date !== "" && Number.isFinite(b.close) && b.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const firstTxnDate = normalized[0].date;
  const gridSet = new Set<string>();
  for (const symbol of heldSymbols) {
    for (const bar of bars[symbol]) {
      if (bar.date >= firstTxnDate) gridSet.add(bar.date);
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
    let netFlow = 0;
    while (txnPtr < normalized.length && normalized[txnPtr].date <= date) {
      const t = normalized[txnPtr];
      const signedQty = t.type === "BUY" ? t.quantity : -t.quantity;
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

/** Daily modified-Dietz return: r_t = (V_t − V_t−1 − netFlow_t) / V_t−1. See portfolioSeries.ts. */
export function flowAdjustedReturns(series: ValueSeries): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.points.length; i++) {
    const prev = series.points[i - 1];
    const cur = series.points[i];
    if (!prev.complete || !cur.complete) continue;
    if (!(prev.value > 0)) continue;
    out.push((cur.value - prev.value - cur.netFlow) / prev.value);
  }
  return out;
}

export const MIN_OBSERVATIONS = 60;
export const MAX_ABS_DRIFT = 0.5;

export interface AssumptionFallback {
  expectedReturn: number;
  volatility: number;
}

/**
 * Mirror of src/lib/assetClassAssumptions.ts's ASSET_ASSUMPTIONS/weightedAssumptions — trimmed to
 * just the {expectedReturn, volatility} pair this tool needs (drops `taxable`, unused here). Same
 * duplication rationale as the rest of this file: kept in sync by hand, not imported, per the
 * house convention documented at the top of this file.
 */
const ASSET_ASSUMPTIONS: Record<string, { expectedReturn: number; volatility: number }> = {
  "Stocks": { expectedReturn: 0.12, volatility: 0.18 },
  "Equity": { expectedReturn: 0.12, volatility: 0.18 },
  "Index": { expectedReturn: 0.11, volatility: 0.17 },
  "ETF": { expectedReturn: 0.11, volatility: 0.17 },
  "Mutual Funds": { expectedReturn: 0.11, volatility: 0.16 },
  "US Stocks / ETFs": { expectedReturn: 0.10, volatility: 0.16 },
  "Bonds": { expectedReturn: 0.07, volatility: 0.04 },
  "Fixed Deposits": { expectedReturn: 0.065, volatility: 0.005 },
  "FDs": { expectedReturn: 0.065, volatility: 0.005 },
  "Gold": { expectedReturn: 0.08, volatility: 0.15 },
  "Gold & Silver": { expectedReturn: 0.08, volatility: 0.15 },
  "Commodity": { expectedReturn: 0.07, volatility: 0.20 },
  "Real Estate": { expectedReturn: 0.08, volatility: 0.10 },
  "Crypto": { expectedReturn: 0.20, volatility: 0.60 },
  "PPF / EPF": { expectedReturn: 0.071, volatility: 0.0 },
  "NPS": { expectedReturn: 0.09, volatility: 0.10 },
  "Cash": { expectedReturn: 0.04, volatility: 0.0 },
  "Custom Assets": { expectedReturn: 0.08, volatility: 0.12 },
};
const DEFAULT_ASSUMPTION = { expectedReturn: 0.10, volatility: 0.14 };

export function weightedAssumptions(weights: { label: string; weight: number }[]): AssumptionFallback {
  const totalW = weights.reduce((s, w) => s + w.weight, 0);
  if (totalW <= 0) return { ...DEFAULT_ASSUMPTION };
  let r = 0;
  let v = 0;
  for (const w of weights) {
    const a = ASSET_ASSUMPTIONS[w.label] ?? DEFAULT_ASSUMPTION;
    const nw = w.weight / totalW;
    r += a.expectedReturn * nw;
    v += a.volatility * nw;
  }
  return { expectedReturn: r, volatility: v };
}

export interface FitResult {
  driftAnnual: number;
  volAnnual: number;
  observations: number;
  periodsPerYear: number;
  rawDriftAnnual: number;
  driftClamped: boolean;
  sufficient: boolean;
  usedFallback: boolean;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clampDrift(drift: number): { value: number; clamped: boolean } {
  if (!Number.isFinite(drift)) return { value: 0, clamped: true };
  if (drift > MAX_ABS_DRIFT) return { value: MAX_ABS_DRIFT, clamped: true };
  if (drift < -MAX_ABS_DRIFT) return { value: -MAX_ABS_DRIFT, clamped: true };
  return { value: drift, clamped: false };
}

/** See src/lib/forecast.ts's `fitParameters` for the full doc comment. */
export function fitParameters(returns: number[], periodsPerYear: number, fallback?: AssumptionFallback): FitResult {
  const observations = returns.length;
  const sufficient = observations >= MIN_OBSERVATIONS;

  if (!sufficient && fallback) {
    return {
      driftAnnual: clampDrift(fallback.expectedReturn).value,
      volAnnual: fallback.volatility,
      observations,
      periodsPerYear,
      rawDriftAnnual: fallback.expectedReturn,
      driftClamped: clampDrift(fallback.expectedReturn).clamped,
      sufficient: false,
      usedFallback: true,
    };
  }

  const mean = observations > 0 ? returns.reduce((s, v) => s + v, 0) / observations : 0;
  const rawDriftAnnual = mean * periodsPerYear;
  const { value: driftAnnual, clamped: driftClamped } = clampDrift(rawDriftAnnual);

  return {
    driftAnnual,
    volAnnual: stdDev(returns) * Math.sqrt(periodsPerYear),
    observations,
    periodsPerYear,
    rawDriftAnnual,
    driftClamped,
    sufficient,
    usedFallback: false,
  };
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface ForecastTerminal {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/**
 * Log-normal GBM terminal-value distribution at `horizonMonths`, monthly steps —
 * `v *= exp((μ_m − σ_m²/2) + σ_m·Z)`. See src/lib/forecast.ts's `forecastParametric` doc comment for
 * why GBM (not the arithmetic walk elsewhere in this repo) and why this can't go negative.
 */
export function forecastParametricTerminal(
  startValue: number,
  driftAnnual: number,
  volAnnual: number,
  horizonMonths: number,
  simulations = 1000,
): ForecastTerminal {
  const months = Math.max(0, Math.floor(horizonMonths));
  const muM = driftAnnual / 12;
  const sigmaM = volAnnual / Math.sqrt(12);
  const logDrift = muM - (sigmaM * sigmaM) / 2;

  const finals: number[] = [];
  for (let s = 0; s < simulations; s++) {
    let v = startValue;
    for (let m = 1; m <= months; m++) {
      const shock = sigmaM === 0 ? 0 : sigmaM * gaussian();
      v = v * Math.exp(logDrift + shock);
      if (v < 0) v = 0;
    }
    finals.push(v);
  }
  finals.sort((a, b) => a - b);

  return {
    p10: percentile(finals, 0.1),
    p25: percentile(finals, 0.25),
    p50: percentile(finals, 0.5),
    p75: percentile(finals, 0.75),
    p90: percentile(finals, 0.9),
  };
}

/** Caveat strings for a fit — mirrors src/lib/forecast.ts's `fitCaveats`, trimmed to what this
 * tool's simpler (non-EWMA) fit can actually trigger. */
export function fitCaveats(fit: FitResult, granularity: SeriesGranularity): string[] {
  const out: string[] = [];
  if (fit.usedFallback) {
    out.push(
      `Only ${fit.observations} return observations available (need ${MIN_OBSERVATIONS} to fit) — drift and ` +
        "volatility fall back to blended asset-class assumptions, not this portfolio's own history.",
    );
  } else if (!fit.sufficient) {
    out.push(
      `Fitted on only ${fit.observations} return observations (below the ${MIN_OBSERVATIONS} needed for a ` +
        "stable estimate) — treat the band as indicative only.",
    );
  }
  if (fit.driftClamped) {
    out.push(
      `Measured drift of ${(fit.rawDriftAnnual * 100).toFixed(1)}%/yr was clamped to ` +
        `${(fit.driftAnnual * 100).toFixed(0)}%/yr — a short window can fit a rate that is real but not projectable.`,
    );
  }
  if (granularity === "monthly") {
    out.push("Price history is monthly, not daily — annualized by 12 periods rather than 252.");
  }
  if (granularity === "mixed" || granularity === "unknown") {
    out.push("Price history has irregular spacing, so the annualization factor is approximate.");
  }
  return out;
}
