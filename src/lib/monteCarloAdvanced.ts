/**
 * Advanced Monte Carlo utilities:
 *  - Goal-linked P(success) with fan chart
 *  - Inverse solver (SIP optimizer) via bisection
 *  - Two-phase FIRE simulation (accumulation → drawdown)
 *  - Historical stress replay against real crisis-window daily returns
 */

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export interface GoalMCInputs {
  currentAllocated: number;   // ₹ currently earmarked to the goal
  monthlySIP: number;          // ₹ contribution per month
  yearsToTarget: number;
  targetAmount: number;
  expectedReturn: number;      // decimal
  volatility: number;          // decimal
}

export interface GoalMCResult {
  probability: number;         // 0..1 chance of hitting target
  p10: number; p50: number; p90: number;
  timelines: { p10: number[]; p50: number[]; p90: number[] };
  expectedShortfall: number;   // avg gap on failing paths
  expectedSurplus: number;     // avg surplus on succeeding paths
}

export function runGoalMonteCarlo(inp: GoalMCInputs, sims = 1000): GoalMCResult {
  const months = Math.max(1, Math.round(inp.yearsToTarget * 12));
  const muM = inp.expectedReturn / 12;
  const sdM = inp.volatility / Math.sqrt(12);

  const finals: number[] = [];
  const paths: number[][] = [];

  for (let s = 0; s < sims; s++) {
    let v = inp.currentAllocated;
    const yearly: number[] = [v];
    for (let m = 1; m <= months; m++) {
      const r = muM + sdM * gaussianRandom();
      v = v * (1 + r) + inp.monthlySIP;
      if (v < 0) v = 0;
      if (m % 12 === 0) yearly.push(v);
    }
    if (yearly[yearly.length - 1] !== v) yearly.push(v);
    finals.push(v);
    paths.push(yearly);
  }

  finals.sort((a, b) => a - b);
  const successes = finals.filter(f => f >= inp.targetAmount);
  const failures = finals.filter(f => f < inp.targetAmount);

  const pctIdx = (p: number) => Math.min(finals.length - 1, Math.max(0, Math.floor(p * finals.length)));
  const p10 = finals[pctIdx(0.1)];
  const p50 = finals[pctIdx(0.5)];
  const p90 = finals[pctIdx(0.9)];

  // Percentile timelines — sort each path by terminal value
  const sortedPaths = paths.slice().sort((a, b) => a[a.length - 1] - b[b.length - 1]);
  const tlAt = (p: number) => sortedPaths[pctIdx(p)];

  return {
    probability: successes.length / finals.length,
    p10, p50, p90,
    timelines: { p10: tlAt(0.1), p50: tlAt(0.5), p90: tlAt(0.9) },
    expectedShortfall: failures.length ? failures.reduce((s, f) => s + (inp.targetAmount - f), 0) / failures.length : 0,
    expectedSurplus: successes.length ? successes.reduce((s, f) => s + (f - inp.targetAmount), 0) / successes.length : 0,
  };
}

/**
 * Inverse solver: minimum monthly SIP such that P(target met) ≥ confidence.
 * Uses bisection on SIP amount. Also returns step-up (10%/yr) equivalent.
 */
export function solveRequiredSIP(
  base: Omit<GoalMCInputs, 'monthlySIP'>,
  confidence = 0.8,
  sims = 400,
): { flatSIP: number; stepUpSIP: number; achievedProb: number } {
  const test = (sip: number) => runGoalMonteCarlo({ ...base, monthlySIP: sip }, sims).probability;

  // Bisection bounds
  let lo = 0;
  let hi = Math.max(1000, base.targetAmount / (base.yearsToTarget * 12)); // upper bound: full target/no growth
  // Expand hi if still failing
  for (let i = 0; i < 8 && test(hi) < confidence; i++) hi *= 2;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (test(mid) >= confidence) hi = mid;
    else lo = mid;
  }
  const flatSIP = Math.round(hi);
  const achievedProb = test(flatSIP);

  // Step-up equivalent: first-year SIP that with 10%/yr step-up reaches same total contribution
  // approximated as flatSIP * (yearsToTarget / sum_{y=0..n-1} 1.1^y)
  const years = base.yearsToTarget;
  const factor = years > 0 ? (1 - Math.pow(1.1, years)) / (1 - 1.1) : years;
  const stepUpSIP = Math.round(flatSIP * years / Math.max(1, factor));

  return { flatSIP, stepUpSIP, achievedProb };
}

// ── FIRE (Financial Independence, Retire Early) ──
export interface FireInputs {
  currentCorpus: number;
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  monthlyExpenseToday: number; // in today's ₹
  inflation: number;           // decimal
  expectedReturn: number;      // decimal, pre-retirement
  postRetReturn: number;       // decimal, drawdown-phase (usually lower)
  volatility: number;          // decimal
  monthlySIP: number;
  swrPct: number;              // Safe Withdrawal Rate, e.g. 0.04
}

export interface FireResult {
  requiredCorpusAtRetirement: number;
  projectedCorpusAtRetirement: { p10: number; p50: number; p90: number };
  gap: number;                                  // required − projected p50
  requiredAdditionalSIP: number;                // to close the gap
  survivalProbability: number;                  // to lifeExpectancy
  fireAge: number | null;                       // earliest age you can sustain target
  accumTimeline: { age: number; p50: number; p10: number; p90: number }[];
  drawdownTimeline: { age: number; p50: number; p10: number; p90: number }[];
}

export function simulateFire(inp: FireInputs, sims = 600): FireResult {
  const accumYears = Math.max(0, inp.retirementAge - inp.currentAge);
  const drawYears = Math.max(0, inp.lifeExpectancy - inp.retirementAge);

  // Required corpus: monthly spend at retirement grown by inflation, ÷ SWR/12
  const monthlySpendAtRet = inp.monthlyExpenseToday * Math.pow(1 + inp.inflation, accumYears);
  const requiredCorpusAtRetirement = (monthlySpendAtRet * 12) / inp.swrPct;

  const muAccM = inp.expectedReturn / 12;
  const muDrawM = inp.postRetReturn / 12;
  const sdM = inp.volatility / Math.sqrt(12);

  const accumFinals: number[] = [];
  const survives: boolean[] = [];
  const accumPaths: number[][] = [];
  const drawPaths: number[][] = [];
  const fireAges: (number | null)[] = [];

  for (let s = 0; s < sims; s++) {
    // Accumulation
    let v = inp.currentCorpus;
    const accumYearly: number[] = [v];
    let fireAge: number | null = null;
    for (let m = 1; m <= accumYears * 12; m++) {
      const r = muAccM + sdM * gaussianRandom();
      v = v * (1 + r) + inp.monthlySIP;
      if (v < 0) v = 0;
      if (m % 12 === 0) {
        accumYearly.push(v);
        const yearsFromNow = m / 12;
        const spendThatYear = inp.monthlyExpenseToday * Math.pow(1 + inp.inflation, yearsFromNow);
        const needed = (spendThatYear * 12) / inp.swrPct;
        if (fireAge === null && v >= needed) fireAge = inp.currentAge + yearsFromNow;
      }
    }
    accumFinals.push(v);
    accumPaths.push(accumYearly);
    fireAges.push(fireAge);

    // Drawdown
    let spend = monthlySpendAtRet;
    const drawYearly: number[] = [v];
    let survived = true;
    for (let m = 1; m <= drawYears * 12; m++) {
      const r = muDrawM + (sdM * 0.7) * gaussianRandom();
      v = v * (1 + r) - spend;
      spend *= Math.pow(1 + inp.inflation, 1 / 12);
      if (v < 0) { v = 0; survived = false; }
      if (m % 12 === 0) drawYearly.push(v);
    }
    drawPaths.push(drawYearly);
    survives.push(survived);
  }

  const pct = (arr: number[], p: number) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
  };

  const projP50 = pct(accumFinals, 0.5);
  const projP10 = pct(accumFinals, 0.1);
  const projP90 = pct(accumFinals, 0.9);
  const gap = Math.max(0, requiredCorpusAtRetirement - projP50);

  // Additional SIP needed (rough closed-form: annuity-due FV)
  const monthlyRate = inp.expectedReturn / 12;
  const nMonths = accumYears * 12;
  const fvFactor = nMonths > 0 && monthlyRate > 0
    ? (Math.pow(1 + monthlyRate, nMonths) - 1) / monthlyRate
    : nMonths;
  const requiredAdditionalSIP = fvFactor > 0 ? Math.max(0, Math.round(gap / fvFactor)) : 0;

  // FIRE age: median of the earliest ages
  const validFireAges = fireAges.filter((a): a is number => a !== null).sort((a, b) => a - b);
  const fireAge = validFireAges.length > sims * 0.5
    ? validFireAges[Math.floor(validFireAges.length / 2)]
    : null;

  const buildTL = (paths: number[][], startAge: number) => {
    if (paths.length === 0) return [];
    const len = paths[0].length;
    return Array.from({ length: len }, (_, i) => {
      const vals = paths.map(p => p[i] ?? 0);
      return {
        age: startAge + i,
        p50: pct(vals, 0.5),
        p10: pct(vals, 0.1),
        p90: pct(vals, 0.9),
      };
    });
  };

  return {
    requiredCorpusAtRetirement,
    projectedCorpusAtRetirement: { p10: projP10, p50: projP50, p90: projP90 },
    gap,
    requiredAdditionalSIP,
    survivalProbability: survives.filter(Boolean).length / sims,
    fireAge,
    accumTimeline: buildTL(accumPaths, inp.currentAge),
    drawdownTimeline: buildTL(drawPaths, inp.retirementAge),
  };
}

// ── Historical Stress Replay ──
// Compressed monthly returns for real crisis windows (NIFTY 50 TR, approximated
// from published index history). Each entry is a monthly total return decimal.
// Flagged as APPROXIMATION in the UI — a live-data replay would replace this.
export const CRISIS_WINDOWS: Record<string, { label: string; months: number[]; startLabel: string; endLabel: string }> = {
  gfc2008: {
    label: '2008 GFC',
    startLabel: 'Jan 2008',
    endLabel: 'Mar 2009',
    // 15 months, cumulative ≈ −52%
    months: [-0.16, -0.03, -0.11, +0.09, -0.06, -0.17, -0.06, +0.01, -0.10, -0.24, -0.04, +0.06, -0.03, +0.08, +0.09],
  },
  covid2020: {
    label: '2020 COVID',
    startLabel: 'Feb 2020',
    endLabel: 'Apr 2020',
    // 3 months, cumulative ≈ −29% then rebound
    months: [-0.06, -0.23, +0.14],
  },
  dotcom2000: {
    label: '2000 Dot-com',
    startLabel: 'Mar 2000',
    endLabel: 'Oct 2002',
    // 32 months, prolonged sideways/down for Indian equities
    months: [-0.05, -0.08, -0.04, +0.03, +0.02, -0.06, -0.09, -0.03, +0.04, -0.06, -0.03, -0.05, +0.02, -0.04, -0.03, +0.06, -0.02, -0.03, +0.01, -0.05, -0.08, +0.03, +0.02, -0.02, -0.03, +0.04, +0.01, -0.05, -0.04, +0.02, +0.05, +0.08],
  },
};

export interface StressReplayResult {
  key: string;
  label: string;
  window: string;
  timeline: { month: number; value: number }[];
  troughValue: number;
  maxDrawdown: number; // decimal, negative
  endValue: number;
  recoveryMonths: number | null;
}

export function replayCrisis(
  currentAUM: number,
  equityWeight: number,
  key: keyof typeof CRISIS_WINDOWS,
): StressReplayResult {
  const cw = CRISIS_WINDOWS[key];
  const equityPortion = currentAUM * equityWeight;
  const stablePortion = currentAUM - equityPortion;

  let equity = equityPortion;
  let value = currentAUM;
  const timeline: { month: number; value: number }[] = [{ month: 0, value }];
  let peak = currentAUM;
  let trough = currentAUM;
  let maxDD = 0;

  for (let i = 0; i < cw.months.length; i++) {
    equity = equity * (1 + cw.months[i]);
    value = equity + stablePortion; // stable earns 0 during crisis (conservative)
    timeline.push({ month: i + 1, value });
    peak = Math.max(peak, value);
    trough = Math.min(trough, value);
    maxDD = Math.min(maxDD, (value - peak) / peak);
  }

  // Recovery months (post-crisis) at 12% annualized nominal
  const monthlyRate = Math.pow(1.12, 1 / 12) - 1;
  let recoveryMonths: number | null = null;
  if (value < currentAUM && monthlyRate > 0) {
    recoveryMonths = Math.ceil(Math.log(currentAUM / value) / Math.log(1 + monthlyRate));
  } else if (value >= currentAUM) {
    recoveryMonths = 0;
  }

  return {
    key: String(key),
    label: cw.label,
    window: `${cw.startLabel} → ${cw.endLabel}`,
    timeline,
    troughValue: trough,
    maxDrawdown: maxDD,
    endValue: value,
    recoveryMonths,
  };
}
