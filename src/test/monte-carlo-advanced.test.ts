// Unit tests for the advanced Monte Carlo utilities. See src/lib/monteCarloAdvanced.ts.
// runGoalMonteCarlo / solveRequiredSIP / simulateFire are stochastic (Math.random, not seedable),
// so they're tested for statistical invariants; replayCrisis replays a fixed historical-return
// table with no randomness, so it's tested against exact precomputed numbers.
import { describe, expect, it } from 'vitest';
import { runGoalMonteCarlo, solveRequiredSIP, stepUpEquivalentSIP, simulateFire, replayCrisis, type GoalMCInputs, type FireInputs } from '@/lib/monteCarloAdvanced';

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

// ---- Audit M11 --------------------------------------------------------------------------------------------

/**
 * Expected corpus of a monthly SIP schedule under the goal simulation's own growth: each month the balance
 * grows by annualReturn/12 and the SIP is added at month end. Written independently of stepUpEquivalentSIP so
 * the test is not circular.
 */
function expectedCorpus(sipForMonth: (m: number) => number, months: number, annualReturn: number): number {
  let v = 0;
  for (let m = 1; m <= months; m++) v = v * (1 + annualReturn / 12) + sipForMonth(m);
  return v;
}

describe('stepUpEquivalentSIP — equal future value, not equal rupees (audit M11)', () => {
  const years = 10;
  const months = years * 12;
  const r = 0.1;
  const flat = 10_000;
  const stepUpSchedule = (first: number) => (m: number) => first * 1.1 ** Math.floor((m - 1) / 12);

  it('reaches exactly the same expected corpus as the flat plan', () => {
    const flatCorpus = expectedCorpus(() => flat, months, r);
    const stepUp = stepUpEquivalentSIP(flat, years, r);

    expect(expectedCorpus(stepUpSchedule(stepUp), months, r)).toBeCloseTo(flatCorpus, 4);
  });

  it('asks for more in year 1 than the old equal-rupees formula, which fell short of the flat corpus', () => {
    // The audit's example: the old formula's ₹6,275 reached only ~₹18.95L against ₹20.48L for the flat plan.
    const flatCorpus = expectedCorpus(() => flat, months, r);
    expect(flatCorpus).toBeGreaterThan(2_040_000);
    expect(flatCorpus).toBeLessThan(2_060_000);

    const oldFactor = (1 - 1.1 ** years) / (1 - 1.1);
    const oldStepUp = (flat * years) / oldFactor; // ~6,275
    expect(oldStepUp).toBeCloseTo(6275, -1);
    expect(expectedCorpus(stepUpSchedule(oldStepUp), months, r)).toBeLessThan(flatCorpus * 0.95); // ~7.5% short

    const fixed = stepUpEquivalentSIP(flat, years, r);
    expect(fixed).toBeGreaterThan(oldStepUp);
    expect(fixed).toBeLessThan(flat); // still a lower year-1 outflow than the flat plan
  });

  it('is just the flat SIP for a horizon under a year, where no step-up ever happens', () => {
    expect(stepUpEquivalentSIP(10_000, 0.5, 0.1)).toBeCloseTo(10_000, 6); // old formula returned 5,000
    expect(stepUpEquivalentSIP(10_000, 1, 0.1)).toBeCloseTo(10_000, 6); // exactly one year: one block, no step
  });

  it('with a 0% step-up the equivalent is the flat SIP itself', () => {
    expect(stepUpEquivalentSIP(10_000, 10, 0.1, 0)).toBeCloseTo(10_000, 6);
  });

  it('with a 0% return it falls back to equal rupees contributed', () => {
    // No growth: future value is just the sum, so matching corpus == matching total rupees.
    const stepUp = stepUpEquivalentSIP(10_000, 10, 0, 0.1);
    const oldFactor = (1 - 1.1 ** 10) / (1 - 1.1);
    expect(stepUp).toBeCloseTo((10_000 * 10) / oldFactor, 6);
  });

  it('handles a fractional horizon by month rather than throwing or going negative', () => {
    const stepUp = stepUpEquivalentSIP(10_000, 2.5, 0.12);
    expect(Number.isFinite(stepUp)).toBe(true);
    expect(stepUp).toBeGreaterThan(0);
    expect(stepUp).toBeLessThanOrEqual(10_000);
    const flatCorpus = expectedCorpus(() => 10_000, 30, 0.12);
    expect(expectedCorpus((m) => stepUp * 1.1 ** Math.floor((m - 1) / 12), 30, 0.12)).toBeCloseTo(flatCorpus, 4);
  });

  it('is what solveRequiredSIP reports as stepUpSIP', () => {
    const base = { currentAllocated: 0, yearsToTarget: 10, targetAmount: 2_000_000, expectedReturn: 0.1, volatility: 0.15 };
    const { flatSIP, stepUpSIP } = solveRequiredSIP(base, 0.8, 200);
    expect(stepUpSIP).toBe(Math.round(stepUpEquivalentSIP(flatSIP, 10, 0.1, 0.1)));
    expect(stepUpSIP).toBeLessThan(flatSIP);
  });
});
