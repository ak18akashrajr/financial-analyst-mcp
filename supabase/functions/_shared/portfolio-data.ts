// Shared portfolio data access + calculations, used by the MCP server tools.
// Each function queries only what it needs from Postgres rather than the old
// approach of dumping the entire portfolio into one context string.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { createLogger } from "./logger.ts";

const logger = createLogger("portfolio-data");

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
  /** False when `priceMap` had no entry for this symbol — currentValue/pnl are
   * placeholders (0), not real figures. Callers should exclude these from
   * totals/percentages rather than let a missing price read as a 100% loss. */
  hasPriceData: boolean;
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
      const hasPriceData = symbol in priceMap;
      const cp = hasPriceData ? Number(priceMap[symbol]) : 0;
      const currentValue = hasPriceData ? cp * h.qty : 0;
      const pnl = hasPriceData ? currentValue - h.invested : 0;
      const pnlPercent = hasPriceData && h.invested !== 0 ? (pnl / h.invested) * 100 : 0;
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
        hasPriceData,
      };
    });
}

/**
 * Splits holdings into those with a real price (current or point-in-time) and
 * those without one — e.g. a just-bought symbol not yet synced into
 * current_prices, or one with no historical_prices row on/before an asOfDate.
 * Callers should aggregate totals/percentages from `priced` only and surface
 * `missingSymbols` as a note, rather than let a missing price silently read
 * as a fabricated ₹0 value / 100% loss.
 */
export function splitByPriceAvailability(
  holdings: Holding[],
): { priced: Holding[]; missingSymbols: string[] } {
  return {
    priced: holdings.filter((h) => h.hasPriceData),
    missingSymbols: holdings.filter((h) => !h.hasPriceData).map((h) => h.symbol),
  };
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

export interface CashSettings {
  liquid: number;
  vault: number;
  /** Provident/EPF balance — counts toward net worth like cash, unaffected by an equity shock. */
  pf: number;
  /** Outstanding credit card liability — subtracted from net worth, unaffected by an equity shock. */
  creditCardDebt: number;
}

export async function fetchCash(sb: SupabaseClient): Promise<CashSettings> {
  const { data } = await sb.from("cash_settings").select("*").limit(1).single();
  return {
    liquid: Number(data?.liquid_cash || 0),
    vault: Number(data?.vault_cash || 0),
    pf: Number(data?.pf_balance || 0),
    creditCardDebt: Number(data?.credit_card_debt || 0),
  };
}

/** Current holdings + cash, computed fresh from live tables. */
export async function getCurrentPortfolio(sb: SupabaseClient) {
  const [txns, prices, meta, cash] = await Promise.all([
    fetchTxns(sb),
    fetchCurrentPriceMap(sb),
    fetchMetaMap(sb),
    fetchCash(sb),
  ]);
  const { priced: holdings, missingSymbols: missingPriceSymbols } = splitByPriceAvailability(
    computeHoldingsFromTxns(txns, prices, meta),
  );
  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  const totalCurrentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalPnl = totalCurrentValue - totalInvested;
  // Matches the frontend's net-worth formula (usePortfolio.ts's PortfolioSummary.totalPortfolioValue /
  // recordNetWorthSnapshot) — PF balance counts toward it, credit card debt is subtracted. Previously
  // this only summed liquid + vault cash, silently understating net worth for anyone carrying either.
  const totalPortfolioValue = totalCurrentValue + cash.liquid + cash.vault + cash.pf - cash.creditCardDebt;
  return { holdings, txns, totalInvested, totalCurrentValue, totalPnl, cash, totalPortfolioValue, missingPriceSymbols };
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

/**
 * Daily log-return series for every symbol in `symbols`, most recent `days`
 * points each — one `historical_prices` query for the whole batch (via
 * `.in("symbol", ...)`), grouped and sliced per symbol in memory, instead of
 * N separate `.eq("symbol", ...)` queries awaited one at a time in a loop.
 * See docs/perf-findings.md#4.
 *
 * A single query can't express "most recent N rows per symbol" the way
 * `.limit()` did per-symbol — so this orders the whole batch by date
 * descending and takes the first `days + 1` rows per symbol after grouping,
 * which is equivalent for a plain per-symbol slice.
 */
async function fetchDailyReturnsBySymbol(
  sb: SupabaseClient,
  symbols: string[],
  days: number,
): Promise<Record<string, number[]>> {
  if (symbols.length === 0) return {};
  const { data } = await sb
    .from("historical_prices")
    .select("symbol, date, close")
    .in("symbol", symbols)
    .order("date", { ascending: false });

  const rowsBySymbol: Record<string, { date: string; close: number }[]> = {};
  for (const r of (data || []) as { symbol: string; date: string; close: number }[]) {
    (rowsBySymbol[r.symbol] ||= []).push({ date: r.date, close: Number(r.close) });
  }

  const returnsBySymbol: Record<string, number[]> = {};
  for (const symbol of symbols) {
    const closes = (rowsBySymbol[symbol] || []).slice(0, days + 1).map((r) => r.close).reverse();
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    returnsBySymbol[symbol] = returns;
  }
  return returnsBySymbol;
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
 * Fetches every holding's historical_prices in one batched query (see
 * fetchDailyReturnsBySymbol) rather than one query per holding, awaited
 * serially in a loop — see docs/perf-findings.md#4.
 */
export async function getRiskMetrics(
  sb: SupabaseClient,
  holdings: Holding[],
  lookbackDays = 90,
) {
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const { data: benchRows, error: benchError } = await sb
    .from("benchmark_history")
    .select("date, close")
    .eq("symbol", "NIFTY50")
    .order("date", { ascending: false })
    .limit(lookbackDays + 1);
  if (benchError) {
    logger.error("getRiskMetrics: benchmark_history query failed", { error: benchError });
  }
  const benchCloses = (benchRows || []).map((r) => Number(r.close)).reverse();
  const benchReturns: number[] = [];
  for (let i = 1; i < benchCloses.length; i++) {
    if (benchCloses[i - 1] > 0) benchReturns.push((benchCloses[i] - benchCloses[i - 1]) / benchCloses[i - 1]);
  }
  const benchmarkDataAvailable = benchReturns.length >= 2;

  const returnsBySymbol = await fetchDailyReturnsBySymbol(sb, holdings.map((h) => h.symbol), lookbackDays);

  const perHolding = [];
  let weightedVol = 0;
  let weightedBeta = 0;
  for (const h of holdings) {
    const returns = returnsBySymbol[h.symbol] || [];
    const dailyVol = stdDev(returns);
    const annualizedVol = dailyVol * Math.sqrt(252) * 100; // %
    const symbolBeta = benchmarkDataAvailable ? beta(returns, benchReturns) : null;
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
    // null (not 0.00) when there's no NIFTY50 benchmark data to compare
    // against yet — a real zero-beta result would be misleading here. Run
    // the fetch-benchmark-prices edge function to populate benchmark_history.
    portfolioBetaVsNifty50: benchmarkDataAvailable ? Number(weightedBeta.toFixed(2)) : null,
    perHolding,
    note: benchmarkDataAvailable
      ? "Volatility/beta estimated from available historical_prices/benchmark_history rows; " +
        "symbols with fewer than 2 data points are excluded from the weighted average."
      : "Volatility estimated from historical_prices; beta vs NIFTY50 is not available because " +
        "benchmark_history has no NIFTY50 data yet — run the fetch-benchmark-prices edge function to backfill it.",
  };
}

/**
 * Simulates a market shock across holdings (cash, PF, and credit card debt are unaffected).
 * By default the shock applies uniformly to every holding. Pass `symbols` to shock only those
 * holdings instead — e.g. "what if just NIFTYBEES.NS dropped 20%?" — while every other holding
 * (and cash/PF/debt) is carried through unchanged. This is what a single-holding what-if question
 * should call rather than have the model derive the impact itself: see docs/perf-findings.md's
 * portfolio-ai validation notes for why that matters (the model can't be trusted to subtract a
 * partial shock from a total portfolio value correctly in free text).
 */
export function runStressTest(
  holdings: Holding[],
  cash: CashSettings,
  shockPercent: number,
  symbols?: string[],
) {
  const factor = 1 + shockPercent / 100;
  const shockedSet = symbols ? new Set(symbols) : null;
  const shocked = holdings.map((h) => {
    const applies = !shockedSet || shockedSet.has(h.symbol);
    const shockedValue = applies ? h.currentValue * factor : h.currentValue;
    return {
      symbol: h.symbol,
      currentValue: Math.round(h.currentValue),
      shockedValue: Math.round(shockedValue),
      loss: Math.round(h.currentValue - shockedValue),
    };
  });
  const totalCurrentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalShockedValue = shocked.reduce((s, h) => s + h.shockedValue, 0);
  const cashNet = cash.liquid + cash.vault + cash.pf - cash.creditCardDebt;
  const totalPortfolioBefore = totalCurrentValue + cashNet;
  const totalPortfolioAfter = totalShockedValue + cashNet; // cash/PF/debt unaffected by an equity shock
  const totalPortfolioBeforeRounded = Math.round(totalPortfolioBefore);
  const totalPortfolioAfterRounded = Math.round(totalPortfolioAfter);
  return {
    shockPercent,
    ...(symbols ? { shockedSymbols: symbols } : {}),
    holdings: shocked,
    totalEquityBefore: Math.round(totalCurrentValue),
    totalEquityAfter: Math.round(totalShockedValue),
    totalPortfolioBefore: totalPortfolioBeforeRounded,
    totalPortfolioAfter: totalPortfolioAfterRounded,
    totalLoss: totalPortfolioBeforeRounded - totalPortfolioAfterRounded,
    totalLossPercent: totalPortfolioBeforeRounded !== 0
      ? Number((((totalPortfolioBeforeRounded - totalPortfolioAfterRounded) / totalPortfolioBeforeRounded) * 100).toFixed(2))
      : 0,
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

/** Builds the user-facing `note` for compareToBenchmark based on which series lack history. */
export function buildBenchmarkCompareNote(
  portfolioPoints: number,
  benchmarkPoints: number,
  benchmarkSymbol: string,
): string | undefined {
  const portfolioShort = portfolioPoints < 2;
  const benchmarkShort = benchmarkPoints < 2;
  if (!portfolioShort && !benchmarkShort) return undefined;
  if (portfolioShort && benchmarkShort) {
    return `Insufficient history in net_worth_history and no ${benchmarkSymbol} data in benchmark_history for this window ` +
      "— run the fetch-benchmark-prices edge function to backfill the benchmark.";
  }
  if (benchmarkShort) {
    return `No ${benchmarkSymbol} data in benchmark_history for this window — run the fetch-benchmark-prices ` +
      "edge function to backfill it.";
  }
  return "Insufficient history in net_worth_history for this window.";
}

/** Compares portfolio total-return % against a benchmark's return % over the same window. */
export async function compareToBenchmark(
  sb: SupabaseClient,
  holdings: Holding[],
  benchmarkSymbol: string,
  days: number,
) {
  const { data: nwRows, error: nwError } = await sb
    .from("net_worth_history")
    .select("recorded_at, portfolio_value")
    .order("recorded_at", { ascending: false })
    .limit(days + 1);
  if (nwError) logger.error("compareToBenchmark: net_worth_history query failed", { error: nwError });
  const { data: benchRows, error: benchError } = await sb
    .from("benchmark_history")
    .select("date, close")
    .eq("symbol", benchmarkSymbol)
    .order("date", { ascending: false })
    .limit(days + 1);
  if (benchError) logger.error("compareToBenchmark: benchmark_history query failed", { error: benchError });

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
    note: buildBenchmarkCompareNote(portfolioSeries.length, benchSeries.length, benchmarkSymbol),
  };
}

// ── Period (quarter/half/year) performance ──
//
// get_portfolio_summary is a point-in-time snapshot with no time dimension —
// it has no concept of "this quarter". A question naming a time window needs
// this instead. FY runs Apr-Mar, matching src/lib/periodReports.ts (the
// Reports page's own period math) — reimplemented here rather than imported
// because edge functions never import from src/ (different runtime/bundler;
// see CLAUDE.md's frontend/edge-function boundary). All period boundaries
// are plain "YYYY-MM-DD" strings, matching the string-date comparisons used
// everywhere else in this file, rather than JS Date arithmetic subject to
// timezone drift.
export type PeriodType = "quarter" | "half" | "year";

export interface FYPeriod {
  index: number;
  key: string; // e.g. "FY2026-27-Q2"
  label: string; // e.g. "Q2 FY2026-27 (Jul-Sep 2026)"
  start: string; // inclusive, "YYYY-MM-DD"
  end: string; // exclusive, "YYYY-MM-DD"
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number): string {
  return `${y}-${pad2(m)}-01`; // always the 1st of the month — the only day period boundaries fall on
}

function fyLabel(fyStartYear: number): string {
  return `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
}

/** Which FY (by its April start year) a given "YYYY-MM-DD" date falls in. */
export function fyStartYearFromDate(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export function buildFYPeriods(fyStartYear: number, type: PeriodType): FYPeriod[] {
  const fy = fyLabel(fyStartYear);
  if (type === "quarter") {
    return [
      { index: 1, key: `${fy}-Q1`, label: `Q1 ${fy} (Apr-Jun ${fyStartYear})`, start: ymd(fyStartYear, 4), end: ymd(fyStartYear, 7) },
      { index: 2, key: `${fy}-Q2`, label: `Q2 ${fy} (Jul-Sep ${fyStartYear})`, start: ymd(fyStartYear, 7), end: ymd(fyStartYear, 10) },
      { index: 3, key: `${fy}-Q3`, label: `Q3 ${fy} (Oct-Dec ${fyStartYear})`, start: ymd(fyStartYear, 10), end: ymd(fyStartYear + 1, 1) },
      { index: 4, key: `${fy}-Q4`, label: `Q4 ${fy} (Jan-Mar ${fyStartYear + 1})`, start: ymd(fyStartYear + 1, 1), end: ymd(fyStartYear + 1, 4) },
    ];
  }
  if (type === "half") {
    return [
      { index: 1, key: `${fy}-H1`, label: `H1 ${fy} (Apr-Sep ${fyStartYear})`, start: ymd(fyStartYear, 4), end: ymd(fyStartYear, 10) },
      { index: 2, key: `${fy}-H2`, label: `H2 ${fy} (Oct ${fyStartYear}-Mar ${fyStartYear + 1})`, start: ymd(fyStartYear, 10), end: ymd(fyStartYear + 1, 4) },
    ];
  }
  return [{ index: 1, key: `${fy}-FY`, label: `Full Year ${fy}`, start: ymd(fyStartYear, 4), end: ymd(fyStartYear + 1, 4) }];
}

/**
 * Resolves which period a caller means: an explicit `periodIndex` within
 * `fyStartYear` (or the FY containing `todayStr` if omitted), or — when
 * neither is given — whichever period actually contains today. Falling
 * outside every period only happens when an explicit past/future
 * `fyStartYear` is given without a `periodIndex`; in that case this falls
 * back to the FY's last period (past FY) or first period (future FY) rather
 * than throwing, since "which quarter of a past year did you mean" has no
 * single right answer.
 */
export function resolveFYPeriod(todayStr: string, periodType: PeriodType, fyStartYear?: number, periodIndex?: number): FYPeriod {
  const fy = fyStartYear ?? fyStartYearFromDate(todayStr);
  const periods = buildFYPeriods(fy, periodType);
  if (periodIndex !== undefined) {
    const found = periods.find((p) => p.index === periodIndex);
    if (!found) {
      throw new Error(`periodIndex must be between 1 and ${periods[periods.length - 1].index} for periodType "${periodType}"`);
    }
    return found;
  }
  return (
    periods.find((p) => todayStr >= p.start && todayStr < p.end) ??
    (todayStr < periods[0].start ? periods[0] : periods[periods.length - 1])
  );
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Most recent historical_prices close on/before `asOf`, per symbol. */
async function fetchPriceMapAsOf(sb: SupabaseClient, asOf: string): Promise<Record<string, number>> {
  const { data } = await sb
    .from("historical_prices")
    .select("symbol, date, close")
    .lte("date", asOf)
    .order("date", { ascending: false });
  const map: Record<string, number> = {};
  for (const row of (data || []) as { symbol: string; date: string; close: number }[]) {
    if (!(row.symbol in map)) map[row.symbol] = Number(row.close); // first hit = most recent <= asOf
  }
  return map;
}

/** Cash/PF/debt as of `asOf`: nearest net_worth_history snapshot at-or-before it, else — only when
 * `useLiveFallback` — today's live cash, else zeros. Never blends today's cash into a past date. */
async function fetchCashAsOf(
  sb: SupabaseClient,
  asOf: string,
  liveCash: CashSettings,
  useLiveFallback: boolean,
): Promise<{ cash: CashSettings; source: "history" | "live" | "none" }> {
  const { data } = await sb
    .from("net_worth_history")
    .select("recorded_at, liquid_cash, vault_cash, pf_balance, credit_card_debt")
    .lte("recorded_at", asOf)
    .order("recorded_at", { ascending: false })
    .limit(1);
  const row = (data || [])[0] as Record<string, unknown> | undefined;
  if (row) {
    return {
      cash: {
        liquid: Number(row.liquid_cash || 0),
        vault: Number(row.vault_cash || 0),
        pf: Number(row.pf_balance || 0),
        creditCardDebt: Number(row.credit_card_debt || 0),
      },
      source: "history",
    };
  }
  if (useLiveFallback) return { cash: liveCash, source: "live" };
  return { cash: { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 }, source: "none" };
}

/**
 * Performance over a specific FY period (quarter/half/year) — as opposed to get_portfolio_summary's
 * point-in-time snapshot. Marks start-of-period holdings at the closest historical_prices close
 * on/before the period start (never live), matching src/lib/periodReports.ts's audit rules: a
 * completed period is marked entirely with historical closes (never today's live price), while an
 * in-progress period marks its end at live prices. Separates market appreciation from new money by
 * subtracting netInvestedInPeriod (buys minus sells within the period) from the raw value change.
 */
export async function getPeriodPerformance(
  sb: SupabaseClient,
  currentHoldings: Holding[],
  currentCash: CashSettings,
  periodType: PeriodType = "quarter",
  fyStartYear?: number,
  periodIndex?: number,
  now: Date = new Date(),
  currentMissingPriceSymbols: string[] = [],
) {
  const todayStr = now.toISOString().slice(0, 10);
  const period = resolveFYPeriod(todayStr, periodType, fyStartYear, periodIndex);
  const status: "upcoming" | "in-progress" | "completed" =
    todayStr < period.start ? "upcoming" : todayStr >= period.end ? "completed" : "in-progress";

  const base = {
    periodType,
    periodKey: period.key,
    periodLabel: period.label,
    periodStart: period.start,
    periodEnd: period.end,
    status,
  };

  if (status === "upcoming") {
    return { ...base, note: `This ${periodType} hasn't started yet (starts ${period.start}) — no performance to report.` };
  }

  const useLiveForEnd = status === "in-progress";
  const endAsOf = useLiveForEnd ? todayStr : dayBefore(period.end);

  const [txns, meta] = await Promise.all([fetchTxns(sb), fetchMetaMap(sb)]);
  const [startPriceMap, endPriceMap] = await Promise.all([
    fetchPriceMapAsOf(sb, period.start),
    useLiveForEnd ? Promise.resolve({}) : fetchPriceMapAsOf(sb, endAsOf),
  ]);

  const { priced: startHoldings, missingSymbols: missingStartPrice } = splitByPriceAvailability(
    computeHoldingsFromTxns(txns, startPriceMap, meta, period.start),
  );
  let endHoldings: Holding[];
  let missingEndPrice: string[];
  if (useLiveForEnd) {
    endHoldings = currentHoldings; // already live-priced and pre-filtered by getCurrentPortfolio
    missingEndPrice = currentMissingPriceSymbols;
  } else {
    const split = splitByPriceAvailability(computeHoldingsFromTxns(txns, endPriceMap, meta, endAsOf));
    endHoldings = split.priced;
    missingEndPrice = split.missingSymbols;
  }

  const [{ cash: startCash, source: startCashSource }, { cash: endCash }] = await Promise.all([
    fetchCashAsOf(sb, period.start, currentCash, false),
    fetchCashAsOf(sb, endAsOf, currentCash, useLiveForEnd),
  ]);

  const startEquity = startHoldings.reduce((s, h) => s + h.currentValue, 0);
  const endEquity = endHoldings.reduce((s, h) => s + h.currentValue, 0);
  const startPortfolioValue = startEquity + startCash.liquid + startCash.vault + startCash.pf - startCash.creditCardDebt;
  const endPortfolioValue = endEquity + endCash.liquid + endCash.vault + endCash.pf - endCash.creditCardDebt;

  const inPeriod = txns.filter((t) => t.date >= period.start && t.date <= endAsOf);
  let buyCount = 0, sellCount = 0, buyValue = 0, sellValue = 0;
  for (const t of inPeriod) {
    const v = Number(t.quantity) * Number(t.price);
    if (t.type === "BUY") { buyCount++; buyValue += v; } else { sellCount++; sellValue += v; }
  }
  const netInvested = buyValue - sellValue;
  const marketGain = endPortfolioValue - startPortfolioValue - netInvested;
  const marketGainPercent = startPortfolioValue !== 0 ? Number(((marketGain / startPortfolioValue) * 100).toFixed(2)) : null;

  const notes: string[] = [
    status === "completed"
      ? "Both start and end values use historical_prices closes on or before their respective dates — a completed period is never re-priced with today's live price."
      : "startPortfolioValue marks holdings at the closest historical_prices close on or before the period start; endPortfolioValue uses today's live prices since this period is still in progress.",
    "marketGain/marketGainPercent isolates price appreciation only — netInvestedInPeriod (buys minus sells within the period) is subtracted out first, so adding new money doesn't inflate the reported gain.",
  ];
  if (missingStartPrice.length > 0) {
    notes.push(`No historical_prices row on or before ${period.start} for ${missingStartPrice.join(", ")} — excluded from startPortfolioValue, not counted as ₹0.`);
  }
  if (missingEndPrice.length > 0) {
    notes.push(`No price available as of ${endAsOf} for ${missingEndPrice.join(", ")} — excluded from endPortfolioValue, not counted as ₹0.`);
  }
  if (startCashSource === "none") {
    notes.push("No net_worth_history snapshot on or before the period start — start-of-period cash/PF/credit-card-debt assumed ₹0 rather than today's live values.");
  }

  return {
    ...base,
    startPortfolioValue: Math.round(startPortfolioValue),
    endPortfolioValue: Math.round(endPortfolioValue),
    netInvestedInPeriod: Math.round(netInvested),
    buyCount,
    sellCount,
    marketGain: Math.round(marketGain),
    marketGainPercent,
    note: notes.join(" "),
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

  const { priced: currentHoldings, missingSymbols: missingCurrentPrice } = splitByPriceAvailability(
    computeHoldingsFromTxns(txns, prices, meta),
  );
  const { priced: pastHoldings, missingSymbols: missingPastPrice } = splitByPriceAvailability(
    computeHoldingsFromTxns(txns, pastPriceMap, meta, asOfDate),
  );

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

  const notes = ["Past valuation uses the closest historical_prices row on or before asOfDate per symbol."];
  if (missingCurrentPrice.length > 0) {
    notes.push(
      `No current price available for ${missingCurrentPrice.join(", ")} — excluded from current-side exposure, not counted as 0%.`,
    );
  }
  if (missingPastPrice.length > 0) {
    notes.push(
      `No historical_prices row on or before ${asOfDate} for ${missingPastPrice.join(", ")} — excluded from ` +
        "past-side exposure; this does not necessarily mean the position was 0% back then.",
    );
  }

  return {
    asOfDate,
    geographyDrift: diffExposure("geography"),
    categoryDrift: diffExposure("category"),
    note: notes.join(" "),
  };
}
