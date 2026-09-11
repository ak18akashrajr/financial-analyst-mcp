import { describe, expect, it } from 'vitest';
import { annualizedReturn, beta, computeRiskMetrics, dailyReturnsFromCloses, RISK_FREE_RATE, stdDev } from '@/lib/riskMetrics';

describe('dailyReturnsFromCloses', () => {
  it('computes simple daily returns from ascending closes', () => {
    expect(dailyReturnsFromCloses([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it('skips a step where the prior close is non-positive rather than dividing by it', () => {
    expect(dailyReturnsFromCloses([0, 100])).toEqual([]);
  });

  it('returns an empty array for fewer than 2 closes', () => {
    expect(dailyReturnsFromCloses([100])).toEqual([]);
    expect(dailyReturnsFromCloses([])).toEqual([]);
  });
});

describe('stdDev', () => {
  it('is 0 for fewer than 2 values or a constant series', () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([0.01])).toBe(0);
    expect(stdDev([0.01, 0.01, 0.01])).toBe(0);
  });

  it('is nonzero for a genuinely varying series', () => {
    expect(stdDev([0.1, -0.1, 0.1, -0.1])).toBeGreaterThan(0);
  });
});

describe('beta', () => {
  it('defaults to 1 (market-neutral) with fewer than 2 aligned points', () => {
    expect(beta([0.01], [0.01])).toBe(1);
  });

  it('is 1 when the two series move identically', () => {
    const r = [0.01, -0.02, 0.03, -0.01];
    expect(beta(r, r)).toBeCloseTo(1, 6);
  });

  it('is 0 when the holding never moves regardless of the benchmark', () => {
    const flat = [0, 0, 0, 0];
    const bench = [0.01, -0.02, 0.03, -0.01];
    expect(beta(flat, bench)).toBe(0);
  });
});

describe('annualizedReturn', () => {
  it('is 0 for an empty series', () => {
    expect(annualizedReturn([])).toBe(0);
  });

  it('annualizes the mean daily return by 252 trading days', () => {
    expect(annualizedReturn([0.01, 0.01, 0.01])).toBeCloseTo(0.01 * 252, 10);
  });
});

describe('computeRiskMetrics', () => {
  const holdings = [{ symbol: 'AAPL', currentValue: 1000 }];

  it('reports null beta/alpha, but a real (non-null) Sharpe ratio, with no benchmark data', () => {
    const returns = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const result = computeRiskMetrics(holdings, { AAPL: returns }, []);
    expect(result.benchmarkDataAvailable).toBe(false);
    expect(result.portfolioBetaVsNifty50).toBeNull();
    expect(result.portfolioAlphaPercent).toBeNull();
    expect(result.perHolding[0].beta).toBeNull();
    expect(result.perHolding[0].alpha).toBeNull();
    // Sharpe needs only volatility + the risk-free rate, not benchmark data.
    expect(typeof result.portfolioSharpeRatio).toBe('number');
    expect(typeof result.perHolding[0].sharpeRatio).toBe('number');
    // Equal +1%/-1% swings average to a 0% return -> not > 0 -> riskPerRupeeOfReturn undefined.
    expect(result.portfolioRiskPerRupeeOfReturn).toBeNull();
    expect(result.perHolding[0].riskPerRupeeOfReturn).toBeNull();
  });

  it('computes a real beta, Alpha and Sharpe ratio once benchmark returns are available', () => {
    const returns = Array.from({ length: 20 }, () => 0.01);
    const bench = Array.from({ length: 20 }, () => 0.005);
    const result = computeRiskMetrics(holdings, { AAPL: returns }, bench);
    expect(result.benchmarkDataAvailable).toBe(true);
    expect(typeof result.portfolioBetaVsNifty50).toBe('number');
    expect(typeof result.portfolioAlphaPercent).toBe('number');
    expect(typeof result.portfolioSharpeRatio).toBe('number');
    expect(result.riskFreeRatePercent).toBe(Number((RISK_FREE_RATE * 100).toFixed(2)));
  });

  it('gives a flat (zero-volatility) holding a null Sharpe ratio but a real Alpha of exactly -riskFreeRatePercent', () => {
    // Zero variance in its own returns -> beta 0 (see the `beta` suite above) -> CAPM predicts
    // exactly the risk-free rate for this holding; actual return is 0, so alpha == -risk-free rate.
    const flatReturns = Array.from({ length: 20 }, () => 0);
    const bench = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
    const result = computeRiskMetrics(holdings, { AAPL: flatReturns }, bench);
    const aapl = result.perHolding[0];
    expect(aapl.annualizedVolatilityPercent).toBe(0);
    expect(aapl.beta).toBe(0);
    expect(aapl.sharpeRatio).toBeNull();
    expect(aapl.alpha).toBe(-result.riskFreeRatePercent);
  });

  it('excludes a symbol with fewer than 2 data points from the weighted portfolio figures', () => {
    const twoHoldings = [
      { symbol: 'AAPL', currentValue: 1000 },
      { symbol: 'TCS', currentValue: 1000 },
    ];
    const result = computeRiskMetrics(
      twoHoldings,
      { AAPL: Array.from({ length: 20 }, () => 0.01), TCS: [0.01] },
      [],
    );
    const tcs = result.perHolding.find((h) => h.symbol === 'TCS')!;
    expect(tcs.annualizedVolatilityPercent).toBeNull();
    expect(tcs.alpha).toBeNull();
    expect(tcs.sharpeRatio).toBeNull();
    expect(tcs.riskPerRupeeOfReturn).toBeNull();
    // AAPL alone (the only symbol with enough data) should still drive the portfolio-level figure.
    expect(result.portfolioAnnualizedVolatilityPercent).toBe(0);
  });
});

describe('computeRiskMetrics — riskPerRupeeOfReturn ("unit economics" statement)', () => {
  const holdings = [{ symbol: 'AAPL', currentValue: 1000 }];

  it('is null whenever return is zero or negative — the ratio is not meaningful without real profit', () => {
    // A steady decline: every daily return is -0.5%, so the annualized return is negative.
    const decliningReturns = Array.from({ length: 20 }, () => -0.005);
    const result = computeRiskMetrics(holdings, { AAPL: decliningReturns }, []);
    expect(result.perHolding[0].annualizedReturnPercent).toBeLessThan(0);
    expect(result.perHolding[0].riskPerRupeeOfReturn).toBeNull();
    expect(result.portfolioRiskPerRupeeOfReturn).toBeNull();
  });

  it('equals annualizedVolatilityPercent ÷ annualizedReturnPercent whenever return is positive', () => {
    const returns = [
      0.02, -0.01, 0.015, -0.005, 0.03, 0.01, -0.02, 0.025, 0.005, -0.01,
      0.02, 0.01, -0.015, 0.03, 0.005, -0.01, 0.02, 0.015, -0.005, 0.01,
    ];
    const result = computeRiskMetrics(holdings, { AAPL: returns }, []);
    const h = result.perHolding[0];
    expect(h.annualizedReturnPercent).toBeGreaterThan(0);
    expect(h.riskPerRupeeOfReturn).not.toBeNull();
    expect(h.riskPerRupeeOfReturn).toBeCloseTo(h.annualizedVolatilityPercent! / h.annualizedReturnPercent!, 1);
    expect(result.portfolioRiskPerRupeeOfReturn).toBeCloseTo(
      result.portfolioAnnualizedVolatilityPercent / result.portfolioAnnualizedReturnPercent,
      1,
    );
  });

  it('is 0 (not null) for a holding with zero volatility but a genuinely positive return', () => {
    // Every daily return is identically +0.1% -> stdDev is 0 (no variance) even though the mean,
    // and therefore the annualized return, is positive — a real edge case (a "smooth trend"), not
    // a bug: zero measured volatility genuinely means zero risk per rupee of that profit.
    const smoothPositiveReturns = Array.from({ length: 20 }, () => 0.001);
    const result = computeRiskMetrics(holdings, { AAPL: smoothPositiveReturns }, []);
    const h = result.perHolding[0];
    expect(h.annualizedVolatilityPercent).toBe(0);
    expect(h.annualizedReturnPercent).toBeGreaterThan(0);
    expect(h.riskPerRupeeOfReturn).toBe(0);
  });
});
