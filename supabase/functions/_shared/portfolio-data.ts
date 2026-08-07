// Shared portfolio data access + calculations, used by the MCP server tools.
// Each function queries only what it needs from Postgres rather than the old
// approach of dumping the entire portfolio into one context string.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export function getSupabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

export interface Holding {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  geography: string;
  category: string;
}

export interface Txn {
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  date: string;
}

/**
 * Replays transactions (optionally only up to `asOfDate`) into net quantity +
 * invested amount per symbol, then prices them at `priceMap`. Used both for
 * "current holdings" (no asOfDate, current price map) and for point-in-time
 * reconstructions (get_exposure_drift).
 */
export function computeHoldingsFromTxns(
  txns: Txn[],
  priceMap: Record<string, number>,
  metaMap: Record<string, { geography: string; sector: string }>,
  asOfDate?: string,
): Holding[] {
  const relevant = asOfDate ? txns.filter((t) => t.date <= asOfDate) : txns;
  const bySymbol: Record<string, { qty: number; invested: number }> = {};
  for (const t of relevant) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { qty: 0, invested: 0 };
    const entry = bySymbol[t.symbol];
    if (t.type === "BUY") {
      entry.qty += Number(t.quantity);
      entry.invested += Number(t.quantity) * Number(t.price);
    } else {
      entry.qty -= Number(t.quantity);
      entry.invested -= Number(t.quantity) * Number(t.price);
    }
  }

  return Object.entries(bySymbol)
    .filter(([, h]) => h.qty > 1e-9)
    .map(([symbol, h]) => {
      const cp = priceMap[symbol] || 0;
      const currentValue = cp * h.qty;
      const pnl = currentValue - h.invested;
      const pnlPercent = h.invested !== 0 ? (pnl / h.invested) * 100 : 0;
      const m = metaMap[symbol];
      return {
        symbol,
        quantity: h.qty,
        avgPrice: h.invested / h.qty,
        currentPrice: cp,
        invested: h.invested,
        currentValue,
        pnl,
        pnlPercent,
        geography: m?.geography || "Untagged",
        category: m?.sector || "Untagged",
      };
    });
}

export async function fetchTxns(sb: SupabaseClient): Promise<Txn[]> {
  const { data } = await sb.from("transactions").select("*").order("date", { ascending: true });
  return (data || []) as Txn[];
}

export async function fetchCurrentPriceMap(sb: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await sb.from("current_prices").select("*");
  const map: Record<string, number> = {};
  for (const p of data || []) map[p.symbol] = Number(p.price);
  return map;
}

export async function fetchMetaMap(
  sb: SupabaseClient,
): Promise<Record<string, { geography: string; sector: string }>> {
  const { data } = await sb.from("symbol_metadata").select("*");
  const map: Record<string, { geography: string; sector: string }> = {};
  for (const m of data || []) map[m.symbol] = { geography: m.geography, sector: m.sector };
  return map;
}

export async function fetchCash(sb: SupabaseClient): Promise<{ liquid: number; vault: number }> {
  const { data } = await sb.from("cash_settings").select("*").limit(1).single();
  return { liquid: Number(data?.liquid_cash || 0), vault: Number(data?.vault_cash || 0) };
}

/** Current holdings + cash, computed fresh from live tables. */
export async function getCurrentPortfolio(sb: SupabaseClient) {
  const [txns, prices, meta, cash] = await Promise.all([
    fetchTxns(sb),
    fetchCurrentPriceMap(sb),
    fetchMetaMap(sb),
    fetchCash(sb),
  ]);
  const holdings = computeHoldingsFromTxns(txns, prices, meta);
  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  const totalCurrentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalPnl = totalCurrentValue - totalInvested;
  const totalPortfolioValue = totalCurrentValue + cash.liquid + cash.vault;
  return { holdings, txns, totalInvested, totalCurrentValue, totalPnl, cash, totalPortfolioValue };
}

export function exposureBy(holdings: Holding[], key: "geography" | "category") {
  const map: Record<string, number> = {};
  for (const h of holdings) map[h[key]] = (map[h[key]] || 0) + h.currentValue;
  const total = holdings.reduce((s, h) => s + h.currentValue, 0);
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value: Math.round(value),
      percent: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0,
    }));
}

export function concentrationRisk(holdings: Holding[], topN = 5) {
  const total = holdings.reduce((s, h) => s + h.currentValue, 0);
  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue).slice(0, topN);
  const rows = sorted.map((h) => ({
    symbol: h.symbol,
    value: Math.round(h.currentValue),
    weightPercent: total > 0 ? Number(((h.currentValue / total) * 100).toFixed(1)) : 0,
  }));
  const topNWeight = rows.reduce((s, r) => s + r.weightPercent, 0);
  return { rows, topNWeight: Number(topNWeight.toFixed(1)) };
}

/** Daily log-return series for a symbol from historical_prices, most recent `days` points. */
async function fetchDailyReturns(
  sb: SupabaseClient,
  symbol: string,
  days: number,
): Promise<number[]> {
  const { data } = await sb
    .from("historical_prices")
    .select("date, close")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(days + 1);
  const closes = (data || []).map((r) => Number(r.close)).reverse();
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Beta of `returns` against `benchmarkReturns`, aligned by trimming to the shorter series' length. */
function beta(returns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(returns.length, benchmarkReturns.length);
  if (n < 2) return 1; // not enough data — assume market-neutral
  const r = returns.slice(-n);
  const b = benchmarkReturns.slice(-n);
  const meanR = r.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (r[i] - meanR) * (b[i] - meanB);
    varB += (b[i] - meanB) ** 2;
  }
  if (varB === 0) return 1;
  return cov / varB;
}

/**
 * Per-holding + portfolio-level annualized volatility and beta vs NIFTY 50,
 * computed from historical_prices / benchmark_history over `lookbackDays`.
 * Symbols/benchmark rows with insufficient history are skipped gracefully.
 */
export async function getRiskMetrics(
  sb: SupabaseClient,
  holdings: Holding[],
  lookbackDays = 90,
) {
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const { data: benchRows } = await sb
    .from("benchmark_history")
    .select("date, close")
    .eq("symbol", "NIFTY50")
    .order("date", { ascending: false })
    .limit(lookbackDays + 1);
  const benchCloses = (benchRows || []).map((r) => Number(r.close)).reverse();
  const benchReturns: number[] = [];
  for (let i = 1; i < benchCloses.length; i++) {
    if (benchCloses[i - 1] > 0) benchReturns.push((benchCloses[i] - benchCloses[i - 1]) / benchCloses[i - 1]);
  }

  const perHolding = [];
  let weightedVol = 0;
  let weightedBeta = 0;
  for (const h of holdings) {
    const returns = await fetchDailyReturns(sb, h.symbol, lookbackDays);
    const dailyVol = stdDev(returns);
    const annualizedVol = dailyVol * Math.sqrt(252) * 100; // %
    const symbolBeta = benchReturns.length >= 2 ? beta(returns, benchReturns) : null;
    const weight = totalValue > 0 ? h.currentValue / totalValue : 0;
    if (returns.length >= 2) {
      weightedVol += annualizedVol * weight;
      if (symbolBeta !== null) weightedBeta += symbolBeta * weight;
    }
    perHolding.push({
      symbol: h.symbol,
      annualizedVolatilityPercent: returns.length >= 2 ? Number(annualizedVol.toFixed(1)) : null,
      beta: symbolBeta !== null ? Number(symbolBeta.toFixed(2)) : null,
      dataPoints: returns.length,
    });
  }

  return {
    portfolioAnnualizedVolatilityPercent: Number(weightedVol.toFixed(1)),
    portfolioBetaVsNifty50: Number(weightedBeta.toFixed(2)),
    perHolding,
    note:
      "Volatility/beta estimated from available historical_prices/benchmark_history rows; " +
      "symbols with fewer than 2 data points are excluded from the weighted average.",
  };
}

/** Simulates a uniform market shock across all holdings (cash is unaffected). */
export function runStressTest(holdings: Holding[], cash: { liquid: number; vault: number }, shockPercent: number) {
  const factor = 1 + shockPercent / 100;
  const shocked = holdings.map((h) => ({
    symbol: h.symbol,
    currentValue: Math.round(h.currentValue),
    shockedValue: Math.round(h.currentValue * factor),
    loss: Math.round(h.currentValue * (1 - factor)),
  }));
  const totalCurrentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalShockedValue = shocked.reduce((s, h) => s + h.shockedValue, 0);
  const totalPortfolioBefore = totalCurrentValue + cash.liquid + cash.vault;
  const totalPortfolioAfter = totalShockedValue + cash.liquid + cash.vault; // cash unaffected by equity shock
  return {
    shockPercent,
    holdings: shocked,
    totalEquityBefore: Math.round(totalCurrentValue),
    totalEquityAfter: Math.round(totalShockedValue),
    totalPortfolioBefore: Math.round(totalPortfolioBefore),
    totalPortfolioAfter: Math.round(totalPortfolioAfter),
    totalLoss: Math.round(totalPortfolioBefore - totalPortfolioAfter),
  };
}

export interface LimitBreach {
  type: "single_holding" | "top5_concentration" | "sector" | "geography";
  label: string;
  weightPercent: number;
  thresholdPercent: number;
}

/** Flags: any single holding > 15%, top-5 combined > 50%, any sector/geography > 40%. */
export function checkLimitBreaches(holdings: Holding[]): LimitBreach[] {
  const total = holdings.reduce((s, h) => s + h.currentValue, 0);
  if (total === 0) return [];
  const breaches: LimitBreach[] = [];

  const SINGLE_HOLDING_LIMIT = 15;
  const TOP5_LIMIT = 50;
  const SECTOR_GEO_LIMIT = 40;

  for (const h of holdings) {
    const weight = (h.currentValue / total) * 100;
    if (weight > SINGLE_HOLDING_LIMIT) {
      breaches.push({ type: "single_holding", label: h.symbol, weightPercent: Number(weight.toFixed(1)), thresholdPercent: SINGLE_HOLDING_LIMIT });
    }
  }

  const { topNWeight } = concentrationRisk(holdings, 5);
  if (topNWeight > TOP5_LIMIT) {
    breaches.push({ type: "top5_concentration", label: "Top 5 holdings", weightPercent: topNWeight, thresholdPercent: TOP5_LIMIT });
  }

  for (const [label, value] of Object.entries(
    holdings.reduce((m: Record<string, number>, h) => ((m[h.category] = (m[h.category] || 0) + h.currentValue), m), {}),
  )) {
    const weight = (value / total) * 100;
    if (weight > SECTOR_GEO_LIMIT) breaches.push({ type: "sector", label, weightPercent: Number(weight.toFixed(1)), thresholdPercent: SECTOR_GEO_LIMIT });
  }

  for (const [label, value] of Object.entries(
    holdings.reduce((m: Record<string, number>, h) => ((m[h.geography] = (m[h.geography] || 0) + h.currentValue), m), {}),
  )) {
    const weight = (value / total) * 100;
    if (weight > SECTOR_GEO_LIMIT) breaches.push({ type: "geography", label, weightPercent: Number(weight.toFixed(1)), thresholdPercent: SECTOR_GEO_LIMIT });
  }

  return breaches;
}

/** Compares portfolio total-return % against a benchmark's return % over the same window. */
export async function compareToBenchmark(
  sb: SupabaseClient,
  holdings: Holding[],
  benchmarkSymbol: string,
  days: number,
) {
  const { data: nwRows } = await sb
    .from("net_worth_history")
    .select("recorded_at, portfolio_value")
    .order("recorded_at", { ascending: false })
    .limit(days + 1);
  const { data: benchRows } = await sb
    .from("benchmark_history")
    .select("date, close")
    .eq("symbol", benchmarkSymbol)
    .order("date", { ascending: false })
    .limit(days + 1);

  const portfolioSeries = (nwRows || []).map((r) => Number(r.portfolio_value)).reverse();
  const benchSeries = (benchRows || []).map((r) => Number(r.close)).reverse();

  const portfolioReturnPercent =
    portfolioSeries.length >= 2 && portfolioSeries[0] > 0
      ? ((portfolioSeries[portfolioSeries.length - 1] - portfolioSeries[0]) / portfolioSeries[0]) * 100
      : null;
  const benchmarkReturnPercent =
    benchSeries.length >= 2 && benchSeries[0] > 0
      ? ((benchSeries[benchSeries.length - 1] - benchSeries[0]) / benchSeries[0]) * 100
      : null;

  return {
    benchmarkSymbol,
    windowDays: days,
    portfolioReturnPercent: portfolioReturnPercent !== null ? Number(portfolioReturnPercent.toFixed(2)) : null,
    benchmarkReturnPercent: benchmarkReturnPercent !== null ? Number(benchmarkReturnPercent.toFixed(2)) : null,
    outperformancePercent:
      portfolioReturnPercent !== null && benchmarkReturnPercent !== null
        ? Number((portfolioReturnPercent - benchmarkReturnPercent).toFixed(2))
        : null,
    note:
      portfolioSeries.length < 2 || benchSeries.length < 2
        ? "Insufficient history in net_worth_history or benchmark_history for this window."
        : undefined,
  };
}

/** Compares current geography/category exposure % vs. exposure % as of `asOfDate`. */
export async function getExposureDrift(sb: SupabaseClient, asOfDate: string) {
  const [txns, prices, meta] = await Promise.all([fetchTxns(sb), fetchCurrentPriceMap(sb), fetchMetaMap(sb)]);

  // Price holdings as of asOfDate using the closest historical_prices row on/before that date.
  const { data: histRows } = await sb
    .from("historical_prices")
    .select("symbol, date, close")
    .lte("date", asOfDate)
    .order("date", { ascending: false });
  const pastPriceMap: Record<string, number> = {};
  for (const row of histRows || []) {
    if (!(row.symbol in pastPriceMap)) pastPriceMap[row.symbol] = Number(row.close); // first hit = most recent <= asOfDate
  }

  const currentHoldings = computeHoldingsFromTxns(txns, prices, meta);
  const pastHoldings = computeHoldingsFromTxns(txns, pastPriceMap, meta, asOfDate);

  const diffExposure = (key: "geography" | "category") => {
    const current = exposureBy(currentHoldings, key);
    const past = exposureBy(pastHoldings, key);
    const pastMap = Object.fromEntries(past.map((p) => [p.label, p.percent]));
    return current.map((c) => ({
      label: c.label,
      currentPercent: c.percent,
      pastPercent: pastMap[c.label] ?? 0,
      driftPercentPoints: Number((c.percent - (pastMap[c.label] ?? 0)).toFixed(1)),
    }));
  };

  return {
    asOfDate,
    geographyDrift: diffExposure("geography"),
    categoryDrift: diffExposure("category"),
    note: "Past valuation uses the closest historical_prices row on or before asOfDate per symbol.",
  };
}
