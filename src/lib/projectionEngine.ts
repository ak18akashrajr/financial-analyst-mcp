/**
 * Portfolio Projection Engine
 * 5 scenarios: XIRR, Crash, Monte Carlo, Sequence of Returns, Inflation
 */

export interface ProjectionInputs {
  initialInvestment: number;
  monthlySIP: number;
  timeHorizonYears: number;
  expectedReturnPct: number;
  monthlyWithdrawal: number;
}

// ── 1. XIRR Projection ──
export interface XIRRProjectionResult {
  baseXIRR: number;
  conservativeXIRR: number;
  baseTimeline: { year: number; value: number }[];
  conservativeTimeline: { year: number; value: number }[];
  baseFinalValue: number;
  conservativeFinalValue: number;
}

export function projectXIRR(inputs: ProjectionInputs, currentXIRR: number | null): XIRRProjectionResult {
  const xirr = currentXIRR ?? inputs.expectedReturnPct / 100;
  const baseRate = xirr;
  const conservativeRate = xirr * 0.8; // −20%

  const buildTimeline = (annualRate: number) => {
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
    let value = inputs.initialInvestment;
    const timeline: { year: number; value: number }[] = [{ year: 0, value }];

    for (let m = 1; m <= inputs.timeHorizonYears * 12; m++) {
      value = value * (1 + monthlyRate) + inputs.monthlySIP - inputs.monthlyWithdrawal;
      if (value < 0) value = 0;
      if (m % 12 === 0) {
        timeline.push({ year: m / 12, value });
      }
    }
    return timeline;
  };

  const baseTimeline = buildTimeline(baseRate);
  const conservativeTimeline = buildTimeline(conservativeRate);

  return {
    baseXIRR: baseRate,
    conservativeXIRR: conservativeRate,
    baseTimeline,
    conservativeTimeline,
    baseFinalValue: baseTimeline[baseTimeline.length - 1]?.value ?? 0,
    conservativeFinalValue: conservativeTimeline[conservativeTimeline.length - 1]?.value ?? 0,
  };
}

// ── 2. Crash Scenario ──
export interface CrashScenarioResult {
  scenarios: {
    dropPct: number;
    postCrashValue: number;
    drawdown: number;
    recoveryYears: number;
    finalValue: number;
  }[];
}

export function simulateCrash(inputs: ProjectionInputs): CrashScenarioResult {
  const drops = [20, 35, 50];
  const annualReturn = inputs.expectedReturnPct / 100;
  const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;

  const scenarios = drops.map(dropPct => {
    const drop = dropPct / 100;
    const postCrashValue = inputs.initialInvestment * (1 - drop);
    const drawdown = inputs.initialInvestment - postCrashValue;

    // Recovery time: how many years to get back to initial from post-crash
    const recoveryYears = annualReturn > 0
      ? Math.log(inputs.initialInvestment / postCrashValue) / Math.log(1 + annualReturn)
      : Infinity;

    // Project forward from post-crash value
    let value = postCrashValue;
    for (let m = 1; m <= inputs.timeHorizonYears * 12; m++) {
      value = value * (1 + monthlyRate) + inputs.monthlySIP - inputs.monthlyWithdrawal;
      if (value < 0) value = 0;
    }

    return {
      dropPct,
      postCrashValue,
      drawdown,
      recoveryYears: Math.round(recoveryYears * 10) / 10,
      finalValue: value,
    };
  });

  return { scenarios };
}

// ── 3. Monte Carlo Simulation ──
export interface MonteCarloResult {
  median: number;
  best: number;
  worst: number;
  percentile10: number;
  percentile90: number;
  goalProbability: number;
  distribution: { bucket: string; count: number }[];
  percentileTimelines: {
    p10: { year: number; value: number }[];
    p50: { year: number; value: number }[];
    p90: { year: number; value: number }[];
  };
}

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function runMonteCarlo(inputs: ProjectionInputs, numSims = 1000): MonteCarloResult {
  const annualMean = inputs.expectedReturnPct / 100;
  const annualStdDev = 0.18; // typical equity volatility
  const monthlyMean = annualMean / 12;
  const monthlyStdDev = annualStdDev / Math.sqrt(12);
  const months = inputs.timeHorizonYears * 12;
  const years = inputs.timeHorizonYears;

  const finalValues: number[] = [];
  const allTimelines: number[][] = [];

  for (let s = 0; s < numSims; s++) {
    let value = inputs.initialInvestment;
    const yearlyValues: number[] = [value];

    for (let m = 1; m <= months; m++) {
      const monthlyReturn = monthlyMean + monthlyStdDev * gaussianRandom();
      value = value * (1 + monthlyReturn) + inputs.monthlySIP - inputs.monthlyWithdrawal;
      if (value < 0) value = 0;
      if (m % 12 === 0) yearlyValues.push(value);
    }

    finalValues.push(value);
    allTimelines.push(yearlyValues);
  }

  finalValues.sort((a, b) => a - b);

  const goalTarget = inputs.initialInvestment * 2; // 2x as goal
  const goalCount = finalValues.filter(v => v >= goalTarget).length;

  // Distribution buckets
  const min = finalValues[0];
  const max = finalValues[finalValues.length - 1];
  const bucketCount = 20;
  const bucketSize = (max - min) / bucketCount || 1;
  const buckets: Record<string, number> = {};
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * bucketSize;
    const label = `₹${(lo / 100000).toFixed(1)}L`;
    buckets[label] = 0;
  }
  for (const v of finalValues) {
    const idx = Math.min(Math.floor((v - min) / bucketSize), bucketCount - 1);
    const lo = min + idx * bucketSize;
    const label = `₹${(lo / 100000).toFixed(1)}L`;
    buckets[label] = (buckets[label] || 0) + 1;
  }

  // Percentile timelines
  const getPercentileTimeline = (pct: number) => {
    const sorted = allTimelines.slice().sort((a, b) => (a[a.length - 1] ?? 0) - (b[b.length - 1] ?? 0));
    const idx = Math.floor(pct / 100 * sorted.length);
    const tl = sorted[Math.min(idx, sorted.length - 1)];
    return tl.map((v, i) => ({ year: i, value: v }));
  };

  return {
    median: finalValues[Math.floor(numSims / 2)],
    best: finalValues[finalValues.length - 1],
    worst: finalValues[0],
    percentile10: finalValues[Math.floor(numSims * 0.1)],
    percentile90: finalValues[Math.floor(numSims * 0.9)],
    goalProbability: Math.round((goalCount / numSims) * 100),
    distribution: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
    percentileTimelines: {
      p10: getPercentileTimeline(10),
      p50: getPercentileTimeline(50),
      p90: getPercentileTimeline(90),
    },
  };
}

// ── 4. Sequence of Returns Risk ──
export interface SequenceRiskResult {
  earlyBadTimeline: { year: number; value: number }[];
  lateBadTimeline: { year: number; value: number }[];
  uniformTimeline: { year: number; value: number }[];
  earlyBadFinal: number;
  lateBadFinal: number;
  uniformFinal: number;
}

export function simulateSequenceRisk(inputs: ProjectionInputs): SequenceRiskResult {
  const years = inputs.timeHorizonYears;
  const avgReturn = inputs.expectedReturnPct / 100;
  const badReturn = -0.15;
  const goodReturn = avgReturn + (avgReturn - badReturn) * (2 / (years - 2));
  const badYears = 2;

  const buildTimeline = (returns: number[]) => {
    let value = inputs.initialInvestment;
    const tl: { year: number; value: number }[] = [{ year: 0, value }];

    for (let y = 0; y < years; y++) {
      const annualReturn = returns[y] ?? avgReturn;
      // Apply return, add SIP, subtract withdrawals (annual)
      value = value * (1 + annualReturn) + inputs.monthlySIP * 12 - inputs.monthlyWithdrawal * 12;
      if (value < 0) value = 0;
      tl.push({ year: y + 1, value });
    }
    return tl;
  };

  // Early bad: first 2 years bad
  const earlyReturns = Array(years).fill(goodReturn);
  for (let i = 0; i < Math.min(badYears, years); i++) earlyReturns[i] = badReturn;

  // Late bad: last 2 years bad
  const lateReturns = Array(years).fill(goodReturn);
  for (let i = Math.max(0, years - badYears); i < years; i++) lateReturns[i] = badReturn;

  // Uniform
  const uniformReturns = Array(years).fill(avgReturn);

  const earlyBadTimeline = buildTimeline(earlyReturns);
  const lateBadTimeline = buildTimeline(lateReturns);
  const uniformTimeline = buildTimeline(uniformReturns);

  return {
    earlyBadTimeline,
    lateBadTimeline,
    uniformTimeline,
    earlyBadFinal: earlyBadTimeline[earlyBadTimeline.length - 1]?.value ?? 0,
    lateBadFinal: lateBadTimeline[lateBadTimeline.length - 1]?.value ?? 0,
    uniformFinal: uniformTimeline[uniformTimeline.length - 1]?.value ?? 0,
  };
}

// ── 5. Inflation Adjustment ──
export interface InflationResult {
  scenarios: {
    inflationPct: number;
    nominalTimeline: { year: number; value: number }[];
    realTimeline: { year: number; value: number }[];
    nominalFinal: number;
    realFinal: number;
    purchasingPowerLoss: number;
  }[];
}

export function simulateInflation(inputs: ProjectionInputs): InflationResult {
  const inflationRates = [5, 7, 9];
  const annualReturn = inputs.expectedReturnPct / 100;

  const scenarios = inflationRates.map(infPct => {
    const inf = infPct / 100;
    let nominal = inputs.initialInvestment;
    const nominalTl: { year: number; value: number }[] = [{ year: 0, value: nominal }];
    const realTl: { year: number; value: number }[] = [{ year: 0, value: nominal }];

    for (let y = 1; y <= inputs.timeHorizonYears; y++) {
      nominal = nominal * (1 + annualReturn) + inputs.monthlySIP * 12 - inputs.monthlyWithdrawal * 12;
      if (nominal < 0) nominal = 0;
      nominalTl.push({ year: y, value: nominal });
      realTl.push({ year: y, value: nominal / Math.pow(1 + inf, y) });
    }

    const nominalFinal = nominalTl[nominalTl.length - 1].value;
    const realFinal = realTl[realTl.length - 1].value;

    return {
      inflationPct: infPct,
      nominalTimeline: nominalTl,
      realTimeline: realTl,
      nominalFinal: nominalFinal,
      realFinal: realFinal,
      purchasingPowerLoss: Math.round(((nominalFinal - realFinal) / nominalFinal) * 100),
    };
  });

  return { scenarios };
}
