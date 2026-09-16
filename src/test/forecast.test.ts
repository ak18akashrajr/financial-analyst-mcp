import { describe, expect, it } from 'vitest';
import {
  backtestForecast,
  EWMA_LAMBDA,
  fitCaveats,
  fitParameters,
  forecastBootstrap,
  forecastParametric,
  gaussian,
  MAX_ABS_DRIFT,
  MIN_OBSERVATIONS,
  percentile,
  usableReturnsForBacktest,
} from '@/lib/forecast';
import { flowAdjustedReturns } from '@/lib/portfolioSeries';

/** Deterministic PRNG (mulberry32) so simulated paths are reproducible across runs. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);

describe('fitParameters', () => {
  it('annualizes the mean return by the period count', () => {
    // 252 observations of exactly 0.001 → drift = 0.001 × 252 = 0.252/yr, and zero dispersion.
    const fit = fitParameters(repeat(0.001, 252), 252);

    expect(fit.driftAnnual).toBeCloseTo(0.252, 10);
    expect(fit.volAnnual).toBeCloseTo(0, 12);
    expect(fit.observations).toBe(252);
    expect(fit.sufficient).toBe(true);
    expect(fit.usedFallback).toBe(false);
  });

  it('annualizes volatility by the square root of the period count', () => {
    // Alternating ±0.01 over 100 points: mean 0, so the sample variance is (100 × 0.01²)/99 on the
    // n−1 basis stdDev uses, then annualized by √252.
    const returns = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const expected = Math.sqrt((100 * 0.01 ** 2) / 99) * Math.sqrt(252);

    expect(fitParameters(returns, 252).volAnnual).toBeCloseTo(expected, 10);
  });

  it('annualizes monthly observations by 12, not 252', () => {
    const monthly = fitParameters(repeat(0.01, 60), 12);
    const daily = fitParameters(repeat(0.01, 60), 252);

    expect(monthly.driftAnnual).toBeCloseTo(0.12, 10);
    // The same observations read as daily would fit a drift 21× larger — and get clamped.
    expect(daily.rawDriftAnnual).toBeCloseTo(2.52, 10);
  });

  it('clamps an implausible fitted drift and reports what it measured', () => {
    const fit = fitParameters(repeat(0.01, 252), 252); // 0.01 × 252 = 252%/yr

    expect(fit.rawDriftAnnual).toBeCloseTo(2.52, 10);
    expect(fit.driftAnnual).toBe(MAX_ABS_DRIFT);
    expect(fit.driftClamped).toBe(true);
  });

  it('clamps a catastrophic negative drift symmetrically', () => {
    const fit = fitParameters(repeat(-0.01, 252), 252);

    expect(fit.driftAnnual).toBe(-MAX_ABS_DRIFT);
    expect(fit.driftClamped).toBe(true);
  });

  it('marks a thin sample insufficient without a fallback', () => {
    const fit = fitParameters(repeat(0.001, MIN_OBSERVATIONS - 1), 252);

    expect(fit.sufficient).toBe(false);
    expect(fit.usedFallback).toBe(false);
    expect(fit.observations).toBe(MIN_OBSERVATIONS - 1);
  });

  it('substitutes asset-class assumptions for a thin sample when given a fallback', () => {
    const fit = fitParameters(repeat(0.05, 10), 252, { expectedReturn: 0.11, volatility: 0.16 });

    expect(fit.usedFallback).toBe(true);
    expect(fit.sufficient).toBe(false);
    expect(fit.driftAnnual).toBeCloseTo(0.11, 10);
    expect(fit.volAnnual).toBeCloseTo(0.16, 10);
    // The 10 observations would have fitted 0.05 × 252 = 1260%/yr; the fallback must win outright.
    expect(fit.rawDriftAnnual).toBeCloseTo(0.11, 10);
  });

  it('ignores the fallback once the sample is large enough', () => {
    const fit = fitParameters(repeat(0.0004, MIN_OBSERVATIONS), 252, { expectedReturn: 0.11, volatility: 0.16 });

    expect(fit.usedFallback).toBe(false);
    expect(fit.driftAnnual).toBeCloseTo(0.0004 * 252, 10);
  });

  it('weights a recent volatility spike more heavily in the EWMA figure', () => {
    const calm = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.001 : -0.001));
    const turbulent = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.05 : -0.05));
    const fit = fitParameters([...calm, ...turbulent], 252);

    expect(fit.ewmaVolAnnual).toBeGreaterThan(fit.volAnnual);
  });

  it('agrees with the sample figure when volatility is stable throughout', () => {
    const steady = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const fit = fitParameters(steady, 252);

    expect(fit.ewmaVolAnnual).toBeCloseTo(fit.volAnnual, 2);
  });

  it('exposes the standard RiskMetrics decay', () => {
    expect(EWMA_LAMBDA).toBe(0.94);
  });
});

describe('percentile', () => {
  it('interpolates between neighbouring values', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
  });

  it('returns the endpoints at 0 and 1', () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });

  it('handles degenerate inputs', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.5)).toBe(7);
  });
});

describe('gaussian', () => {
  it('is reproducible for a given seed', () => {
    expect(gaussian(seeded(42))).toBe(gaussian(seeded(42)));
  });

  it('produces a roughly standard normal sample', () => {
    const rng = seeded(7);
    const draws = Array.from({ length: 5000 }, () => gaussian(rng));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((s, v) => s + (v - mean) ** 2, 0) / (draws.length - 1));

    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(sd).toBeCloseTo(1, 1);
  });
});

describe('forecastParametric', () => {
  const fit = { driftAnnual: 0.12, volAnnual: 0.18 };

  it('starts the fan exactly at the current value', () => {
    const fan = forecastParametric(100_000, fit, 12, { simulations: 200, rng: seeded(1) });
    const start = fan.points[0];

    expect(start.monthsAhead).toBe(0);
    expect(start.p10).toBe(100_000);
    expect(start.p50).toBe(100_000);
    expect(start.p90).toBe(100_000);
  });

  it('emits one point per month plus the starting point', () => {
    const fan = forecastParametric(100_000, fit, 36, { simulations: 100, rng: seeded(2) });

    expect(fan.points).toHaveLength(37);
    expect(fan.points[36].monthsAhead).toBe(36);
    expect(fan.horizonMonths).toBe(36);
  });

  it('collapses onto the deterministic compounding path when volatility is zero', () => {
    // σ = 0 ⇒ every path is v0·exp(μ/12 · m); the band has no width at all.
    const fan = forecastParametric(100_000, { driftAnnual: 0.12, volAnnual: 0 }, 12, {
      simulations: 50,
      rng: seeded(3),
    });
    const final = fan.points[12];
    const expected = 100_000 * Math.exp(0.12);

    expect(final.p50).toBeCloseTo(expected, 6);
    expect(final.p10).toBeCloseTo(expected, 6);
    expect(final.p90).toBeCloseTo(expected, 6);
  });

  it('orders the percentiles at every horizon', () => {
    const fan = forecastParametric(100_000, fit, 24, { simulations: 500, rng: seeded(4) });

    for (const p of fan.points.slice(1)) {
      expect(p.p10).toBeLessThan(p.p25);
      expect(p.p25).toBeLessThan(p.p50);
      expect(p.p50).toBeLessThan(p.p75);
      expect(p.p75).toBeLessThan(p.p90);
    }
  });

  it('widens the band as the horizon extends', () => {
    // With a finite number of simulated paths the percentile band is not perfectly monotonic
    // month-to-month (sampling noise), so this checks the overall trend at a few well-separated
    // checkpoints rather than every single step.
    const fan = forecastParametric(100_000, fit, 24, { simulations: 2000, rng: seeded(5) });
    const widthAt = (m: number) => fan.points[m].p90 - fan.points[m].p10;

    expect(widthAt(0)).toBe(0);
    expect(widthAt(6)).toBeGreaterThan(widthAt(0));
    expect(widthAt(12)).toBeGreaterThan(widthAt(6));
    expect(widthAt(24)).toBeGreaterThan(widthAt(12));
  });

  it('never produces a negative value even at a punishing volatility', () => {
    const fan = forecastParametric(100_000, { driftAnnual: -0.5, volAnnual: 0.9 }, 120, {
      simulations: 300,
      rng: seeded(6),
    });

    expect(fan.points.every((p) => p.p10 >= 0)).toBe(true);
  });

  it('adds a monthly contribution on top of market growth', () => {
    const withSip = forecastParametric(100_000, { driftAnnual: 0.12, volAnnual: 0 }, 12, {
      simulations: 20,
      rng: seeded(8),
      monthlyContribution: 10_000,
    });
    const without = forecastParametric(100_000, { driftAnnual: 0.12, volAnnual: 0 }, 12, {
      simulations: 20,
      rng: seeded(8),
    });

    expect(withSip.terminal.p50).toBeGreaterThan(without.terminal.p50 + 120_000);
  });

  it('is reproducible for a given seed', () => {
    const a = forecastParametric(100_000, fit, 12, { simulations: 100, rng: seeded(9) });
    const b = forecastParametric(100_000, fit, 12, { simulations: 100, rng: seeded(9) });

    expect(a.terminal).toEqual(b.terminal);
  });
});

describe('forecastBootstrap', () => {
  it('compounds a constant observed return deterministically', () => {
    // Every resampled block is 0.01, so with 12 periods/year (one per month) the path is
    // v0 × 1.01^m regardless of which block gets drawn.
    const fan = forecastBootstrap(100_000, repeat(0.01, 100), 6, {
      simulations: 20,
      rng: seeded(11),
      periodsPerYear: 12,
    });

    expect(fan.points[6].p50).toBeCloseTo(100_000 * 1.01 ** 6, 4);
    expect(fan.points[6].p10).toBeCloseTo(fan.points[6].p90, 4);
  });

  it('starts at the current value and reports the bootstrap method', () => {
    const fan = forecastBootstrap(50_000, repeat(0.001, 300), 12, { simulations: 50, rng: seeded(12) });

    expect(fan.points[0].p50).toBe(50_000);
    expect(fan.method).toBe('bootstrap');
  });

  it('produces a spread when the observed returns actually vary', () => {
    const returns = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? 0.02 : -0.008));
    const fan = forecastBootstrap(100_000, returns, 12, { simulations: 400, rng: seeded(13) });

    expect(fan.points[12].p90).toBeGreaterThan(fan.points[12].p10);
  });

  it('returns a flat fan rather than inventing a distribution with no observations', () => {
    const fan = forecastBootstrap(100_000, [], 6, { simulations: 10, rng: seeded(14) });

    expect(fan.points.every((p) => p.p50 === 100_000)).toBe(true);
  });

  it('preserves a downside tail a normal fit would smooth away', () => {
    // Mostly flat with occasional -15% crashes: the bootstrap must carry those into the p10.
    const returns = Array.from({ length: 300 }, (_, i) => (i % 50 === 0 ? -0.15 : 0.001));
    const fan = forecastBootstrap(100_000, returns, 24, {
      simulations: 400,
      rng: seeded(15),
      periodsPerYear: 252,
    });

    expect(fan.points[24].p10).toBeLessThan(fan.points[24].p50);
  });
});

describe('backtestForecast', () => {
  // netFlow: 0 throughout — these fixtures model pure price growth with no transactions, so every
  // point's value change is a market return with nothing to strip out.
  const buildPoints = (n: number, growth: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100_000 * (1 + growth) ** i,
      netFlow: 0,
      complete: true,
    }));

  it('returns no folds when there is not enough history to fit and verify', () => {
    const result = backtestForecast(buildPoints(50, 0.001), 12, 252, { simulations: 20 });

    expect(result.folds).toEqual([]);
    expect(result.coverage).toBe(0);
  });

  it('covers most of a trending series with realistic volatility that it was fitted on', () => {
    // A constant, zero-variance return series was tried here first and rejected: with volAnnual = 0
    // the forecast band collapses to a single point (p10 = p50 = p90), so "covered" would require
    // the realized value to land on that exact float — not a meaningful backtest assertion. This
    // series alternates around a 0.05%/period mean with a real ±0.4% swing, giving the fit genuine
    // (if modest, ~6%/yr) volatility to build a band from.
    const n = 600;
    const returns = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.0005 + 0.004 : 0.0005 - 0.004));
    const points = returns.reduce<{ date: string; value: number; netFlow: number; complete: boolean }[]>((acc, r, i) => {
      const prev = i === 0 ? 100_000 : acc[i - 1].value;
      acc.push({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, value: prev * (1 + r), netFlow: 0, complete: true });
      return acc;
    }, []);

    const result = backtestForecast(points, 6, 252, { simulations: 500, rng: seeded(21) });

    expect(result.folds.length).toBeGreaterThan(0);
    // A band fitted on the series' own realized volatility should cover its own (deterministic)
    // continuation more often than not, without demanding every single fold land inside it.
    expect(result.coverage).toBeGreaterThanOrEqual(0.5);
    expect(result.medianAbsErrorPercent).toBeLessThan(15);
  });

  it('reports each fold with its cutoff date and realized value', () => {
    const result = backtestForecast(buildPoints(600, 0.0005), 6, 252, {
      simulations: 100,
      rng: seeded(22),
      folds: 3,
    });

    expect(result.folds.length).toBeLessThanOrEqual(3);
    for (const fold of result.folds) {
      expect(fold.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fold.actual).toBeGreaterThan(0);
      expect(fold.predictedP10).toBeLessThanOrEqual(fold.predictedP50);
      expect(fold.predictedP50).toBeLessThanOrEqual(fold.predictedP90);
    }
  });

  it('excludes a leading incomplete stretch rather than misaligning cutoff indices against it', () => {
    // Regression test: an earlier version filtered `usable` points and sliced the caller's
    // `returns` array separately, so whenever an incomplete stretch existed the two arrays' indices
    // silently drifted apart — `cutoffIndex` meant a different date in each. Points 0-4 are
    // unpriced (as if a symbol was bought before its first price arrived); backtesting must still
    // produce correctly-dated folds from what remains, not garbled ones.
    const points = buildPoints(600, 0.0005).map((p, i) => (i < 5 ? { ...p, complete: false } : p));
    const result = backtestForecast(points, 6, 252, { simulations: 50, rng: seeded(23) });

    expect(result.folds.length).toBeGreaterThan(0);
    for (const fold of result.folds) {
      // Every fold's cutoff/actual dates must come from the priced portion (index >= 5) — a
      // misaligned version could report a date/value pair from the unpriced stretch instead.
      const cutoffPoint = points.find((p) => p.date === fold.cutoffDate && p.complete);
      expect(cutoffPoint).toBeDefined();
    }
  });

});

describe('usableReturnsForBacktest', () => {
  it('keeps usable.length - 1 === returns.length, even across an incomplete stretch', () => {
    // This is the invariant backtestForecast's index alignment depends on — see this function's
    // doc comment for the bug it replaces.
    const points = [
      { date: '2026-01-01', value: 1000, netFlow: 0, complete: true },
      { date: '2026-01-02', value: 1200, netFlow: 500, complete: false },
      { date: '2026-01-03', value: 1300, netFlow: 0, complete: false },
      { date: '2026-01-04', value: 1400, netFlow: 0, complete: true },
      { date: '2026-01-05', value: 1450, netFlow: 0, complete: true },
    ];

    const { usable, returns } = usableReturnsForBacktest(points);

    expect(usable.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-04', '2026-01-05']);
    expect(returns).toHaveLength(2);
  });

  it('folds flow that happened during a skipped incomplete stretch into the next usable return', () => {
    // A ₹500 contribution lands on the unpriced day (a second symbol bought before its first price
    // arrives). Without carrying it forward, the 1000 -> 1400 jump would read as a +40% market
    // return; the real market return is (1400 - 1000 - 500) / 1000 = -10%.
    const points = [
      { date: '2026-01-01', value: 1000, netFlow: 0, complete: true },
      { date: '2026-01-02', value: 1500, netFlow: 500, complete: false },
      { date: '2026-01-03', value: 1400, netFlow: 0, complete: true },
    ];

    const { returns } = usableReturnsForBacktest(points);

    expect(returns).toEqual([-0.1]);
  });

  it('matches flowAdjustedReturns exactly when there are no incomplete points at all', () => {
    const points = [
      { date: '2026-01-01', value: 1000, netFlow: 0, complete: true },
      { date: '2026-01-02', value: 1100, netFlow: 0, complete: true },
      { date: '2026-01-03', value: 1050, netFlow: 200, complete: true },
    ];

    const { usable, returns } = usableReturnsForBacktest(points);

    expect(usable).toEqual(points);
    expect(returns).toEqual(flowAdjustedReturns({ points, granularity: 'daily', periodsPerYear: 252, symbolsWithoutPrices: [], incompletePoints: 0 }));
  });
});

describe('fitCaveats', () => {
  it('is silent for a healthy daily fit', () => {
    const fit = fitParameters(repeat(0.0004, 300), 252);

    expect(fitCaveats(fit, 'daily')).toEqual([]);
  });

  it('names the fallback, the observation count and the requirement', () => {
    const fit = fitParameters(repeat(0.001, 10), 252, { expectedReturn: 0.11, volatility: 0.16 });
    const caveats = fitCaveats(fit, 'daily');

    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toContain('10 return observations');
    expect(caveats[0]).toContain(String(MIN_OBSERVATIONS));
  });

  it('reports a clamped drift with the figure it actually measured', () => {
    const fit = fitParameters(repeat(0.01, 252), 252);
    const caveats = fitCaveats(fit, 'daily');

    expect(caveats.some((c) => c.includes('252.0%/yr') && c.includes('clamped'))).toBe(true);
  });

  it('flags monthly price history as a coarser fit', () => {
    const fit = fitParameters(repeat(0.005, 100), 12);

    expect(fitCaveats(fit, 'monthly').some((c) => c.includes('monthly'))).toBe(true);
  });

  it('flags irregular spacing as an approximate annualization', () => {
    const fit = fitParameters(repeat(0.0004, 100), 52);

    expect(fitCaveats(fit, 'mixed').some((c) => c.includes('irregular'))).toBe(true);
  });
});
