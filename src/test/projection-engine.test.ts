// Unit tests for the 5 projection scenarios. See src/lib/projectionEngine.ts.
// The Monte Carlo scenario is stochastic (uses Math.random internally, not seedable), so it's
// tested for statistical invariants (percentile ordering, bucket counts) rather than exact values;
// everything else here is a closed-form calculation and is tested against exact expected numbers.
import { describe, expect, it } from 'vitest';
import { projectXIRR, simulateCrash, runMonteCarlo, simulateSequenceRisk, simulateInflation, type ProjectionInputs } from '@/lib/projectionEngine';

const baseInputs: ProjectionInputs = {
  initialInvestment: 100000,
  monthlySIP: 0,
  timeHorizonYears: 1,
  expectedReturnPct: 10,
  monthlyWithdrawal: 0,
};

describe('projectXIRR', () => {
  it('compounds monthly to reproduce the exact annual rate after 12 months (no SIP/withdrawal)', () => {
    const result = projectXIRR(baseInputs, 0.10);
    expect(result.baseXIRR).toBe(0.10);
    expect(result.conservativeXIRR).toBeCloseTo(0.08, 10); // 10% * 0.8
    expect(result.baseFinalValue).toBeCloseTo(110000, 4);
    expect(result.conservativeFinalValue).toBeCloseTo(108000, 4);
  });

  it('falls back to expectedReturnPct/100 when currentXIRR is null', () => {
    const result = projectXIRR({ ...baseInputs, expectedReturnPct: 15 }, null);
    expect(result.baseXIRR).toBeCloseTo(0.15, 10);
  });
});

describe('simulateCrash', () => {
  it('computes drawdown and immediate post-crash value for each drop scenario', () => {
    const result = simulateCrash({ ...baseInputs, timeHorizonYears: 0 });
    expect(result.scenarios.map(s => s.dropPct)).toEqual([20, 35, 50]);
    const s20 = result.scenarios[0];
    expect(s20.postCrashValue).toBe(80000);
    expect(s20.drawdown).toBe(20000);
    expect(s20.recoveryYears).toBeCloseTo(2.3, 1); // ln(100000/80000) / ln(1 + 10%)
    expect(s20.finalValue).toBe(80000); // 0-year horizon → no growth applied after the crash
  });

  it('projects forward from the post-crash value over a nonzero horizon', () => {
    const result = simulateCrash({ ...baseInputs, timeHorizonYears: 1 });
    const s20 = result.scenarios[0];
    // Post-crash 80,000 compounds by the same annual rate over 12 months → *1.10
    expect(s20.finalValue).toBeCloseTo(88000, 3);
  });
});

describe('simulateSequenceRisk', () => {
  const inputs: ProjectionInputs = { initialInvestment: 100000, monthlySIP: 1000, timeHorizonYears: 5, expectedReturnPct: 10, monthlyWithdrawal: 0 };

  it('produces early-bad, late-bad, and uniform timelines that differ despite identical average return', () => {
    const result = simulateSequenceRisk(inputs);
    expect(result.earlyBadFinal).toBeCloseTo(238403.72, 1);
    expect(result.lateBadFinal).toBeCloseTo(202595.94, 1);
    expect(result.uniformFinal).toBeCloseTo(234312.20, 1);
    // The whole point of sequence-of-returns risk: same average return, different order → different outcome.
    expect(result.earlyBadFinal).not.toBeCloseTo(result.lateBadFinal, 0);
  });
});

describe('simulateInflation', () => {
  it('computes nominal vs. inflation-adjusted real value for each inflation scenario', () => {
    const result = simulateInflation({ initialInvestment: 100000, monthlySIP: 1000, timeHorizonYears: 3, expectedReturnPct: 10, monthlyWithdrawal: 0 });
    expect(result.scenarios.map(s => s.inflationPct)).toEqual([5, 7, 9]);
    // Nominal final value is identical across scenarios — inflation only affects the "real" line.
    result.scenarios.forEach(s => expect(s.nominalFinal).toBeCloseTo(172820, 0));

    const [at5, at7, at9] = result.scenarios;
    expect(at5.realFinal).toBeCloseTo(149288.41, 1);
    expect(at5.purchasingPowerLoss).toBe(14);
    expect(at9.realFinal).toBeCloseTo(133448.75, 1);
    expect(at9.purchasingPowerLoss).toBe(23);
    // Higher inflation must erode more purchasing power.
    expect(at9.purchasingPowerLoss).toBeGreaterThan(at7.purchasingPowerLoss);
    expect(at7.purchasingPowerLoss).toBeGreaterThan(at5.purchasingPowerLoss);
  });
});

describe('runMonteCarlo (statistical invariants)', () => {
  it('keeps percentiles ordered and bucket counts summing to the simulation count', () => {
    const numSims = 300;
    const result = runMonteCarlo(baseInputs, numSims);
    expect(result.worst).toBeLessThanOrEqual(result.percentile10);
    expect(result.percentile10).toBeLessThanOrEqual(result.median);
    expect(result.median).toBeLessThanOrEqual(result.percentile90);
    expect(result.percentile90).toBeLessThanOrEqual(result.best);
    expect(result.goalProbability).toBeGreaterThanOrEqual(0);
    expect(result.goalProbability).toBeLessThanOrEqual(100);

    const totalBucketed = result.distribution.reduce((s, b) => s + b.count, 0);
    expect(totalBucketed).toBe(numSims);

    // Percentile timelines should run from year 0 through the full horizon.
    expect(result.percentileTimelines.p50[0].year).toBe(0);
    expect(result.percentileTimelines.p50[result.percentileTimelines.p50.length - 1].year).toBe(baseInputs.timeHorizonYears);
  });
});
