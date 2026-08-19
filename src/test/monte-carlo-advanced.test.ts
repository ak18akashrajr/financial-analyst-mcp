// Unit tests for the advanced Monte Carlo utilities. See src/lib/monteCarloAdvanced.ts.
// runGoalMonteCarlo / solveRequiredSIP / simulateFire are stochastic (Math.random, not seedable),
// so they're tested for statistical invariants; replayCrisis replays a fixed historical-return
// table with no randomness, so it's tested against exact precomputed numbers.
import { describe, expect, it } from 'vitest';
import { runGoalMonteCarlo, solveRequiredSIP, simulateFire, replayCrisis, type GoalMCInputs, type FireInputs } from '@/lib/monteCarloAdvanced';

describe('runGoalMonteCarlo', () => {
  const inputs: GoalMCInputs = {
    currentAllocated: 500000,
    monthlySIP: 10000,
    yearsToTarget: 10,
    targetAmount: 3000000,
    expectedReturn: 0.10,
    volatility: 0.15,
  };

  it('keeps percentiles ordered and probability within [0,1]', () => {
    const result = runGoalMonteCarlo(inputs, 500);
    expect(result.p10).toBeLessThanOrEqual(result.p50);
    expect(result.p50).toBeLessThanOrEqual(result.p90);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(result.expectedShortfall).toBeGreaterThanOrEqual(0);
    expect(result.expectedSurplus).toBeGreaterThanOrEqual(0);
  });

  it('reports a near-zero success probability for a target that is essentially unreachable', () => {
    const result = runGoalMonteCarlo({ ...inputs, targetAmount: 1_000_000_000, monthlySIP: 0 }, 300);
    expect(result.probability).toBeLessThan(0.05);
  });

  it('reports a near-certain success probability for a trivially reachable target', () => {
    const result = runGoalMonteCarlo({ ...inputs, targetAmount: 1000, currentAllocated: 500000 }, 300);
    expect(result.probability).toBeGreaterThan(0.95);
  });
});

describe('solveRequiredSIP', () => {
  it('finds a SIP whose achieved probability meets the requested confidence', () => {
    const { flatSIP, achievedProb } = solveRequiredSIP(
      { currentAllocated: 100000, yearsToTarget: 10, targetAmount: 2000000, expectedReturn: 0.10, volatility: 0.15 },
      0.7,
      300,
    );
    expect(flatSIP).toBeGreaterThan(0);
    // Bisection is approximate with a finite simulation count — allow a small tolerance band.
    expect(achievedProb).toBeGreaterThan(0.55);
  });
});

describe('simulateFire', () => {
  const inputs: FireInputs = {
    currentCorpus: 2000000,
    currentAge: 35,
    retirementAge: 60,
    lifeExpectancy: 85,
    monthlyExpenseToday: 50000,
    inflation: 0.06,
    expectedReturn: 0.10,
    postRetReturn: 0.07,
    volatility: 0.15,
    monthlySIP: 30000,
    swrPct: 0.04,
  };

  it('computes the required retirement corpus deterministically from the SWR formula', () => {
    const result = simulateFire(inputs, 200);
    const accumYears = inputs.retirementAge - inputs.currentAge; // 25
    const expectedMonthlySpend = inputs.monthlyExpenseToday * Math.pow(1 + inputs.inflation, accumYears);
    const expectedRequired = (expectedMonthlySpend * 12) / inputs.swrPct;
    expect(result.requiredCorpusAtRetirement).toBeCloseTo(expectedRequired, 2);
  });

  it('keeps projected-corpus percentiles ordered and survival probability within [0,1]', () => {
    const result = simulateFire(inputs, 200);
    expect(result.projectedCorpusAtRetirement.p10).toBeLessThanOrEqual(result.projectedCorpusAtRetirement.p50);
    expect(result.projectedCorpusAtRetirement.p50).toBeLessThanOrEqual(result.projectedCorpusAtRetirement.p90);
    expect(result.survivalProbability).toBeGreaterThanOrEqual(0);
    expect(result.survivalProbability).toBeLessThanOrEqual(1);
    expect(result.gap).toBeGreaterThanOrEqual(0);
  });
});

describe('replayCrisis', () => {
  it('replays the 2020 COVID window against a 100000-value / 60% equity portfolio to exact figures', () => {
    const result = replayCrisis(100000, 0.6, 'covid2020');
    expect(result.timeline.map(t => Math.round(t.value * 100) / 100)).toEqual([100000, 96400, 83428, 89507.92]);
    expect(result.troughValue).toBe(83428);
    expect(result.maxDrawdown).toBeCloseTo(-0.16572, 5);
    expect(result.endValue).toBeCloseTo(89507.92, 2);
    expect(result.recoveryMonths).toBe(12);
  });

  it('reports 0 recovery months when the portfolio ends at or above its starting value', () => {
    // A 100% stable (0% equity) allocation is unaffected by the crisis-window equity returns.
    const result = replayCrisis(100000, 0, 'covid2020');
    expect(result.endValue).toBe(100000);
    expect(result.recoveryMonths).toBe(0);
  });
});
