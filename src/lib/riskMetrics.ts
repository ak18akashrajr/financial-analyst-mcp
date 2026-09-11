/**
 * Per-holding + portfolio-level annualized volatility, beta vs. NIFTY 50, Jensen's Alpha (CAPM),
 * and Sharpe ratio — computed from historical daily returns.
 *
 * This is a frontend mirror of `getRiskMetrics` in
 * supabase/functions/_shared/portfolio-data.ts (used by the portfolio AI's `get_risk_metrics` MCP
 * tool), reimplemented here as a pure function rather than imported directly: that module is Deno
 * edge-function code (`https://esm.sh/...` imports, `Deno.env`) and can't be pulled into the
 * Vite/browser bundle. Keep the two in sync by hand if either changes — the same duplication
 * already used for `compareToBenchmark` vs. src/pages/Benchmark.tsx's own stats calculation.
 *
 * IMPORTANT — "Alpha" naming clash: the Alpha computed here is Jensen's Alpha, the standard CAPM
 * "risk ratio" sense of the word. It is NOT the same metric as the "Realized & Unrealized Alpha"
 * shown on the dashboard (SummaryBar) or "Alpha (USD)" on the Dollar-Adjusted Returns page — both
 * of those are just raw P&L under the same name. Do not conflate the two.
 */
import { INDIA_10Y_GSEC_YIELD } from './sectorBenchmarks';

// Risk-free rate assumption for Alpha/Sharpe below — the 10Y India G-Sec yield, same constant
// already used for the CAPM-style equity-risk-premium calc in deploymentSignal.ts.
export const RISK_FREE_RATE = INDIA_10Y_GSEC_YIELD;

export interface RiskMetricsHolding {
  symbol: string;
  currentValue: number;
}

export interface HoldingRiskMetrics {
  symbol: string;
  annualizedVolatilityPercent: number | null;
  beta: number | null;
  annualizedReturnPercent: number | null;
  /** Jensen's Alpha (CAPM), annualized %. See module doc comment re: the "Alpha" naming clash. */
  alpha: number | null;
  sharpeRatio: number | null;
  dataPoints: number;
}

export interface PortfolioRiskMetrics {
  portfolioAnnualizedVolatilityPercent: number;
  portfolioBetaVsNifty50: number | null;
  portfolioAnnualizedReturnPercent: number;
  portfolioAlphaPercent: number | null;
  portfolioSharpeRatio: number | null;
  riskFreeRatePercent: number;
  benchmarkDataAvailable: boolean;
  perHolding: HoldingRiskMetrics[];
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Beta of `returns` against `benchmarkReturns`, aligned by trimming to the shorter series' length. */
export function beta(returns: number[], benchmarkReturns: number[]): number {
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

/** Mean daily return annualized by trading days (×252) — decimal, not %. */
export function annualizedReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  return (returns.reduce((s, v) => s + v, 0) / returns.length) * 252;
}

/** Daily simple-return series from an ascending-by-date array of closes. */
export function dailyReturnsFromCloses(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

/**
 * Computes every risk metric for `holdings`, given each symbol's daily return series
 * (`returnsBySymbol`, ascending by date — see `dailyReturnsFromCloses`) and the benchmark's own
 * daily return series (`benchReturns`). A symbol with fewer than 2 return data points, or missing
 * from `returnsBySymbol` entirely, is excluded from the weighted portfolio-level figures (though
 * still listed in `perHolding` with null metrics) — mirrors the backend's gating exactly.
 */
export function computeRiskMetrics(
  holdings: RiskMetricsHolding[],
  returnsBySymbol: Record<string, number[]>,
  benchReturns: number[],
): PortfolioRiskMetrics {
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const benchmarkDataAvailable = benchReturns.length >= 2;
  const benchAnnualizedReturn = benchmarkDataAvailable ? annualizedReturn(benchReturns) : null;

  const perHolding: HoldingRiskMetrics[] = [];
  let weightedVol = 0;
  let weightedBeta = 0;
  let weightedReturn = 0;

  for (const h of holdings) {
    const returns = returnsBySymbol[h.symbol] || [];
    const hasData = returns.length >= 2;
    const dailyVol = stdDev(returns);
    const annualizedVol = dailyVol * Math.sqrt(252) * 100; // %
    const symbolAnnualizedReturn = hasData ? annualizedReturn(returns) : null; // decimal
    const symbolBeta = benchmarkDataAvailable ? beta(returns, benchReturns) : null;
    const weight = totalValue > 0 ? h.currentValue / totalValue : 0;
    if (hasData) {
      weightedVol += annualizedVol * weight;
      weightedReturn += symbolAnnualizedReturn! * weight;
      if (symbolBeta !== null) weightedBeta += symbolBeta * weight;
    }

    const symbolAlpha = hasData && symbolBeta !== null && benchAnnualizedReturn !== null
      ? (symbolAnnualizedReturn! - (RISK_FREE_RATE + symbolBeta * (benchAnnualizedReturn - RISK_FREE_RATE))) * 100
      : null;
    // Undefined (not 0 or Infinity) for a flat/zero-volatility holding — dividing by zero vol
    // would misleadingly imply infinite risk-adjusted return rather than "not computable".
    const symbolSharpe = hasData && annualizedVol > 0
      ? (symbolAnnualizedReturn! - RISK_FREE_RATE) / (annualizedVol / 100)
      : null;

    perHolding.push({
      symbol: h.symbol,
      annualizedVolatilityPercent: hasData ? Number(annualizedVol.toFixed(1)) : null,
      beta: symbolBeta !== null ? Number(symbolBeta.toFixed(2)) : null,
      annualizedReturnPercent: symbolAnnualizedReturn !== null ? Number((symbolAnnualizedReturn * 100).toFixed(1)) : null,
      alpha: symbolAlpha !== null ? Number(symbolAlpha.toFixed(2)) : null,
      sharpeRatio: symbolSharpe !== null ? Number(symbolSharpe.toFixed(2)) : null,
      dataPoints: returns.length,
    });
  }

  const portfolioVolDecimal = weightedVol / 100;
  const portfolioAlpha = benchmarkDataAvailable && benchAnnualizedReturn !== null
    ? (weightedReturn - (RISK_FREE_RATE + weightedBeta * (benchAnnualizedReturn - RISK_FREE_RATE))) * 100
    : null;
  const portfolioSharpe = portfolioVolDecimal > 0 ? (weightedReturn - RISK_FREE_RATE) / portfolioVolDecimal : null;

  return {
    portfolioAnnualizedVolatilityPercent: Number(weightedVol.toFixed(1)),
    portfolioBetaVsNifty50: benchmarkDataAvailable ? Number(weightedBeta.toFixed(2)) : null,
    portfolioAnnualizedReturnPercent: Number((weightedReturn * 100).toFixed(1)),
    portfolioAlphaPercent: portfolioAlpha !== null ? Number(portfolioAlpha.toFixed(2)) : null,
    portfolioSharpeRatio: portfolioSharpe !== null ? Number(portfolioSharpe.toFixed(2)) : null,
    riskFreeRatePercent: Number((RISK_FREE_RATE * 100).toFixed(2)),
    benchmarkDataAvailable,
    perHolding,
  };
}
