/**
 * Time series forecasting for the portfolio's total value: fit drift and volatility from the
 * portfolio's own realized return history (src/lib/portfolioSeries.ts), then project forward as a
 * percentile fan.
 *
 * How this differs from the projection code already in this repo, and why both exist:
 *
 *  - projectionEngine.ts / monteCarloAdvanced.ts are ASSUMPTION-driven. `projectXIRR` compounds at
 *    the realized XIRR, `runMonteCarlo` hardcodes σ = 0.18 regardless of what is actually held, and
 *    `weightedAssumptions` (assetClassAssumptions.ts) blends static per-asset-class priors while
 *    explicitly ignoring correlations. They answer "what if returns are X%".
 *  - This module is FITTED. μ and σ come from the portfolio's own observed, flow-adjusted returns,
 *    so a concentrated crypto portfolio and a bond-heavy one get genuinely different fans. It
 *    answers "what does this portfolio's own history imply".
 *
 *  - Those modules walk value arithmetically (`v = v * (1 + r)` with `r ~ N(μ/12, σ/√12)`), which
 *    can go negative — hence their `if (v < 0) v = 0` clamps — and compounds wrongly over
 *    multi-year horizons. This module uses log-normal GBM, `v *= exp((μ − σ²/2)·dt + σ·√dt·Z)`,
 *    which cannot produce a negative value and compounds correctly. The divergence is deliberate;
 *    the existing modules are left alone.
 *
 * Every simulation here takes an injectable `rng` so tests can seed it and assert exact numbers.
 * The existing simulation modules can only be tested for statistical invariants because they call
 * `Math.random` directly.
 */
import { stdDev } from './riskMetrics';
import type { SeriesGranularity, ValuePoint } from './portfolioSeries';

/**
 * Minimum flow-adjusted observations before a fit is trusted. Below this the sample standard
 * deviation is too noisy to annualize and the mean is dominated by whichever few weeks happen to
 * be in the window — the caller is expected to fall back to `weightedAssumptions()` priors.
 */
export const MIN_OBSERVATIONS = 60;

/**
 * Annualized drift is clamped to ±50%. A short, lucky window routinely fits a drift of 200%+/yr;
 * compounding that over a multi-year horizon produces a number that is arithmetically correct and
 * completely meaningless. `driftClamped` surfaces when this bit.
 */
export const MAX_ABS_DRIFT = 0.5;

/** RiskMetrics' standard EWMA decay for daily data — recent observations weigh more. */
export const EWMA_LAMBDA = 0.94;

export interface AssumptionFallback {
  /** Annualized expected return, decimal — e.g. `weightedAssumptions().expectedReturn`. */
  expectedReturn: number;
  /** Annualized volatility, decimal — e.g. `weightedAssumptions().volatility`. */
  volatility: number;
}

export interface FitResult {
  /** Annualized drift, decimal. Clamped — see `MAX_ABS_DRIFT`. */
  driftAnnual: number;
  /** Annualized sample standard deviation of returns, decimal. */
  volAnnual: number;
  /** Annualized EWMA volatility (λ = `EWMA_LAMBDA`), decimal — weights the recent regime more. */
  ewmaVolAnnual: number;
  observations: number;
  periodsPerYear: number;
  /** The pre-clamp drift, kept so a clamped fit can say what it actually measured. */
  rawDriftAnnual: number;
  driftClamped: boolean;
  /** False when `observations < MIN_OBSERVATIONS`. */
  sufficient: boolean;
  /** True when the returned figures came from `AssumptionFallback`, not from the return series. */
  usedFallback: boolean;
}

/**
 * Fits annualized drift and volatility from a flow-adjusted return series.
 *
 * `periodsPerYear` must match the series' actual spacing (`ValueSeries.periodsPerYear` — 252 for
 * daily rows, 12 for monthly): annualizing monthly observations as if they were daily overstates
 * volatility by ~4.6×.
 *
 * With fewer than `MIN_OBSERVATIONS` returns, `fallback` (if given) is returned instead with
 * `usedFallback: true`; with no fallback the thin fit is returned with `sufficient: false` so the
 * caller can decide. Either way `sufficient` reflects the *data*, never the fallback.
 */
export function fitParameters(
  returns: number[],
  periodsPerYear: number,
  fallback?: AssumptionFallback,
): FitResult {
  const observations = returns.length;
  const sufficient = observations >= MIN_OBSERVATIONS;

  if (!sufficient && fallback) {
    return {
      driftAnnual: clampDrift(fallback.expectedReturn).value,
      volAnnual: fallback.volatility,
      ewmaVolAnnual: fallback.volatility,
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

  const sd = stdDev(returns);
  const root = Math.sqrt(periodsPerYear);

  return {
    driftAnnual,
    volAnnual: sd * root,
    ewmaVolAnnual: ewmaStdDev(returns, mean) * root,
    observations,
    periodsPerYear,
    rawDriftAnnual,
    driftClamped,
    sufficient,
    usedFallback: false,
  };
}

function clampDrift(drift: number): { value: number; clamped: boolean } {
  if (!Number.isFinite(drift)) return { value: 0, clamped: true };
  if (drift > MAX_ABS_DRIFT) return { value: MAX_ABS_DRIFT, clamped: true };
  if (drift < -MAX_ABS_DRIFT) return { value: -MAX_ABS_DRIFT, clamped: true };
  return { value: drift, clamped: false };
}

/**
 * Exponentially weighted standard deviation: σ²_t = λ·σ²_{t−1} + (1−λ)·(r_{t−1} − mean)².
 *
 * Seeded with the plain sample variance so a short series degrades to the sample figure rather
 * than to whatever the first observation happened to be. Returns are demeaned — the usual
 * zero-mean shortcut is defensible for daily data but not for monthly rows, which this series can
 * legitimately be made of.
 */
function ewmaStdDev(returns: number[], mean: number): number {
  if (returns.length < 2) return 0;
  const sd = stdDev(returns);
  let variance = sd * sd;
  for (const r of returns) {
    const dev = r - mean;
    variance = EWMA_LAMBDA * variance + (1 - EWMA_LAMBDA) * dev * dev;
  }
  return Math.sqrt(variance);
}

/** Box–Muller standard normal, taking its uniforms from `rng` so it can be seeded in tests. */
export function gaussian(rng: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type ForecastMethod = 'parametric' | 'bootstrap';

export interface ForecastOptions {
  /** Paths to simulate. Default 1000. */
  simulations?: number;
  /** Injected for deterministic tests. Default `Math.random`. */
  rng?: () => number;
  /** Recurring monthly contribution added at each month end, ₹. Default 0. */
  monthlyContribution?: number;
}

export interface BootstrapOptions extends ForecastOptions {
  /**
   * Length in periods of each contiguous block resampled. Blocks rather than single observations
   * so volatility clustering and autocorrelation survive the resampling. Default 20.
   */
  blockSize?: number;
  /** Spacing of the observed returns — `ValueSeries.periodsPerYear`. Default 252. */
  periodsPerYear?: number;
}

export interface FanPoint {
  monthsAhead: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ForecastFan {
  method: ForecastMethod;
  startValue: number;
  horizonMonths: number;
  simulations: number;
  /** One point per month, `monthsAhead: 0` being `startValue` itself. */
  points: FanPoint[];
  terminal: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number };
}

/**
 * Percentile of an already-sorted ascending array, by linear interpolation between neighbours.
 *
 * The existing simulation modules index with `Math.floor(p * n)` instead, which is fine for 600+
 * paths but biases low and is discontinuous — visible as a jittery band on a fan chart, where the
 * whole point is a smooth envelope.
 */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Per-month percentile envelope across simulated paths — the fan chart's actual shape.
 *
 * Note this ranks values independently at each month. `runMonteCarlo.percentileTimelines` in
 * projectionEngine.ts instead ranks whole *paths* by terminal value and returns three of them,
 * which is a different (and for an envelope, wrong) thing. The correct pattern is the one in
 * `simulateFire`'s `buildTL` — this is that, generalized.
 */
function buildFan(paths: number[][], horizonMonths: number): FanPoint[] {
  if (paths.length === 0) return [];
  return Array.from({ length: horizonMonths + 1 }, (_, m) => {
    const column = paths.map((p) => p[m] ?? 0).sort((a, b) => a - b);
    return {
      monthsAhead: m,
      p10: percentile(column, 0.1),
      p25: percentile(column, 0.25),
      p50: percentile(column, 0.5),
      p75: percentile(column, 0.75),
      p90: percentile(column, 0.9),
    };
  });
}

function summarize(
  method: ForecastMethod,
  startValue: number,
  horizonMonths: number,
  paths: number[][],
): ForecastFan {
  const points = buildFan(paths, horizonMonths);
  const finals = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  return {
    method,
    startValue,
    horizonMonths,
    simulations: paths.length,
    points,
    terminal: {
      p10: percentile(finals, 0.1),
      p25: percentile(finals, 0.25),
      p50: percentile(finals, 0.5),
      p75: percentile(finals, 0.75),
      p90: percentile(finals, 0.9),
      mean: finals.length > 0 ? finals.reduce((s, v) => s + v, 0) / finals.length : 0,
    },
  };
}

/**
 * Log-normal GBM projection from the fitted parameters — monthly steps,
 * `v *= exp((μ_m − σ_m²/2) + σ_m·Z)`, with any monthly contribution added at each month end.
 *
 * With σ = 0 every path is identical and the fan collapses onto the deterministic compounding
 * path, which is the correct degenerate case.
 */
export function forecastParametric(
  startValue: number,
  fit: Pick<FitResult, 'driftAnnual' | 'volAnnual'>,
  horizonMonths: number,
  opts: ForecastOptions = {},
): ForecastFan {
  const simulations = Math.max(1, opts.simulations ?? 1000);
  const rng = opts.rng ?? Math.random;
  const contribution = opts.monthlyContribution ?? 0;
  const months = Math.max(0, Math.floor(horizonMonths));

  const muM = fit.driftAnnual / 12;
  const sigmaM = fit.volAnnual / Math.sqrt(12);
  const logDrift = muM - (sigmaM * sigmaM) / 2;

  const paths: number[][] = [];
  for (let s = 0; s < simulations; s++) {
    let v = startValue;
    const path: number[] = [v];
    for (let m = 1; m <= months; m++) {
      const shock = sigmaM === 0 ? 0 : sigmaM * gaussian(rng);
      v = v * Math.exp(logDrift + shock) + contribution;
      if (v < 0) v = 0;
      path.push(v);
    }
    paths.push(path);
  }

  return summarize('parametric', startValue, months, paths);
}

/**
 * Block-bootstrap projection: resamples contiguous blocks of the portfolio's *actual observed*
 * returns rather than drawing from a fitted normal.
 *
 * This makes no distributional assumption at all, so the fat tails and volatility clustering the
 * portfolio really exhibited survive into the forecast — a normal fit systematically understates
 * how bad the bad case gets. Blocks wrap around the end of the series so every observation is
 * equally likely to be drawn.
 *
 * Falls back to a flat (zero-return) fan when there are too few observations to resample, rather
 * than inventing a distribution; callers should check `fit.sufficient` and use
 * `forecastParametric` with assumption priors in that case.
 */
export function forecastBootstrap(
  startValue: number,
  returns: number[],
  horizonMonths: number,
  opts: BootstrapOptions = {},
): ForecastFan {
  const simulations = Math.max(1, opts.simulations ?? 1000);
  const rng = opts.rng ?? Math.random;
  const contribution = opts.monthlyContribution ?? 0;
  const months = Math.max(0, Math.floor(horizonMonths));
  const perYear = opts.periodsPerYear ?? 252;
  const blockSize = Math.max(1, opts.blockSize ?? 20);

  if (returns.length === 0) {
    const flat = [Array.from({ length: months + 1 }, (_, m) => startValue + contribution * m)];
    return summarize('bootstrap', startValue, months, flat);
  }

  const periodsPerMonth = Math.max(1, Math.round(perYear / 12));
  const paths: number[][] = [];

  for (let s = 0; s < simulations; s++) {
    let v = startValue;
    const path: number[] = [v];
    let block: number[] = [];
    let blockPos = blockSize;

    for (let m = 1; m <= months; m++) {
      for (let p = 0; p < periodsPerMonth; p++) {
        if (blockPos >= blockSize) {
          const start = Math.floor(rng() * returns.length);
          block = Array.from({ length: blockSize }, (_, i) => returns[(start + i) % returns.length]);
          blockPos = 0;
        }
        v *= 1 + block[blockPos];
        blockPos++;
        if (v < 0) v = 0;
      }
      v += contribution;
      path.push(v);
    }
    paths.push(path);
  }

  return summarize('bootstrap', startValue, months, paths);
}

export interface BacktestFold {
  /** Grid index the fit was cut off at. */
  cutoffIndex: number;
  cutoffDate: string;
  /** Value actually observed `horizonMonths` later. */
  actual: number;
  predictedP10: number;
  predictedP50: number;
  predictedP90: number;
  /** True when `actual` fell inside the p10–p90 band. */
  covered: boolean;
  /** |predictedP50 − actual| / actual. */
  medianAbsErrorPercent: number;
}

export interface BacktestResult {
  folds: BacktestFold[];
  /** Share of folds whose realized value landed inside the 80% band — should be near 0.8. */
  coverage: number;
  /** Median of the per-fold median-path errors, %. */
  medianAbsErrorPercent: number;
}

/**
 * Derives a self-consistent (usable points, returns) pair for backtesting: `returns[i]` is
 * guaranteed to be exactly the return from `usable[i]` to `usable[i+1]`, so index `cutoffIndex`
 * means the same thing in both arrays.
 *
 * This is deliberately NOT `flowAdjustedReturns`, which — correctly, for fitting a live forecast —
 * drops any pair touching an incomplete point rather than bridging across it (see that function's
 * doc comment). Dropping pairs shrinks the returns array without shrinking `usable` by the same
 * amount whenever an incomplete stretch exists (e.g. a newly-bought symbol before its first price
 * arrives), which desynchronizes `returns[i]` from `usable[i+1]` — a real bug an earlier version of
 * this function had, caught before backtesting was wired into any UI. Here, any flow that happened
 * during a skipped incomplete stretch is carried forward (`pendingFlow`) and folded into the return
 * of the next usable point instead, so `usable.length - 1 === returns.length` always holds.
 */
export function usableReturnsForBacktest(points: ValuePoint[]): { usable: ValuePoint[]; returns: number[] } {
  const usable: ValuePoint[] = [];
  const returns: number[] = [];
  let prev: ValuePoint | null = null;
  let pendingFlow = 0;

  for (const p of points) {
    if (!p.complete) {
      pendingFlow += p.netFlow;
      continue;
    }
    if (prev && prev.value > 0) {
      returns.push((p.value - prev.value - (p.netFlow + pendingFlow)) / prev.value);
    }
    pendingFlow = 0;
    usable.push(p);
    prev = p;
  }

  return { usable, returns };
}

/**
 * Walk-forward validation: fit on everything up to a cutoff, forecast `horizonMonths` ahead, and
 * compare against what actually happened — repeated across several cutoffs.
 *
 * This is the honest answer to "why should I believe this band". Coverage well under 0.8 means the
 * fitted volatility is too low (the band is too narrow to be believed); well over means it is too
 * wide to be useful.
 *
 * Takes the value series' raw points (as `ValueSeries.points` — including `netFlow`, not just
 * `flowAdjustedReturns`' output) and derives its own internally consistent returns per fold; see
 * `usableReturnsForBacktest` for why this can't just reuse the caller's own returns array.
 */
export function backtestForecast(
  points: ValuePoint[],
  horizonMonths: number,
  periodsPerYear: number,
  opts: ForecastOptions & { folds?: number } = {},
): BacktestResult {
  const foldCount = Math.max(1, opts.folds ?? 4);
  const periodsPerMonth = Math.max(1, Math.round(periodsPerYear / 12));
  const horizonPeriods = horizonMonths * periodsPerMonth;
  const { usable, returns } = usableReturnsForBacktest(points);

  const folds: BacktestFold[] = [];
  // Cutoffs are spread across the usable history, each needing MIN_OBSERVATIONS of history behind
  // it and a full horizon of realized data ahead of it.
  const earliest = MIN_OBSERVATIONS;
  const latest = usable.length - 1 - horizonPeriods;
  if (latest > earliest) {
    for (let f = 0; f < foldCount; f++) {
      const cutoffIndex = Math.round(earliest + ((latest - earliest) * f) / Math.max(1, foldCount - 1));
      const fitReturns = returns.slice(0, cutoffIndex);
      if (fitReturns.length < MIN_OBSERVATIONS) continue;

      const fit = fitParameters(fitReturns, periodsPerYear);
      const fan = forecastParametric(usable[cutoffIndex].value, fit, horizonMonths, opts);
      const terminal = fan.terminal;
      const actual = usable[cutoffIndex + horizonPeriods].value;

      folds.push({
        cutoffIndex,
        cutoffDate: usable[cutoffIndex].date,
        actual,
        predictedP10: terminal.p10,
        predictedP50: terminal.p50,
        predictedP90: terminal.p90,
        covered: actual >= terminal.p10 && actual <= terminal.p90,
        medianAbsErrorPercent: actual > 0 ? (Math.abs(terminal.p50 - actual) / actual) * 100 : 0,
      });
    }
  }

  const errors = folds.map((f) => f.medianAbsErrorPercent).sort((a, b) => a - b);
  return {
    folds,
    coverage: folds.length > 0 ? folds.filter((f) => f.covered).length / folds.length : 0,
    medianAbsErrorPercent: errors.length > 0 ? percentile(errors, 0.5) : 0,
  };
}

/** Human-readable caveats for a fit — surfaced in the page's banner and the MCP tool's `note`. */
export function fitCaveats(fit: FitResult, granularity: SeriesGranularity): string[] {
  const out: string[] = [];
  if (fit.usedFallback) {
    out.push(
      `Only ${fit.observations} return observations available (need ${MIN_OBSERVATIONS} to fit) — ` +
        'drift and volatility fall back to blended asset-class assumptions, not this portfolio\'s own history.',
    );
  } else if (!fit.sufficient) {
    out.push(
      `Fitted on only ${fit.observations} return observations (below the ${MIN_OBSERVATIONS} needed for a ` +
        'stable estimate) — treat the band as indicative only.',
    );
  }
  if (fit.driftClamped) {
    out.push(
      `Measured drift of ${(fit.rawDriftAnnual * 100).toFixed(1)}%/yr was clamped to ` +
        `${(fit.driftAnnual * 100).toFixed(0)}%/yr — a short window can fit a rate that is real but not projectable.`,
    );
  }
  if (granularity === 'monthly') {
    out.push('Price history is monthly, not daily — annualized by 12 periods. Backfill daily prices for a finer fit.');
  }
  if (granularity === 'mixed' || granularity === 'unknown') {
    out.push('Price history has irregular spacing, so the annualization factor is approximate.');
  }
  return out;
}
