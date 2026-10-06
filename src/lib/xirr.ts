/**
 * XIRR (Extended Internal Rate of Return) calculation using Newton-Raphson method.
 * Cash flows: negative = outflow (BUY), positive = inflow (SELL or current value).
 */

interface CashFlow {
  amount: number; // negative for investment, positive for return
  date: Date;
}

function daysBetween(d1: Date, d2: Date): number {
  return (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

function npv(rate: number, cashFlows: CashFlow[], d0: Date): number {
  return cashFlows.reduce((sum, cf) => {
    const years = daysBetween(d0, cf.date) / 365;
    return sum + cf.amount / Math.pow(1 + rate, years);
  }, 0);
}

function npvDerivative(rate: number, cashFlows: CashFlow[], d0: Date): number {
  return cashFlows.reduce((sum, cf) => {
    const years = daysBetween(d0, cf.date) / 365;
    return sum + (-years * cf.amount) / Math.pow(1 + rate, years + 1);
  }, 0);
}

const MIN_RATE = -0.99;
const MAX_RATE = 100;
const MAX_ITER = 100;
const TOLERANCE = 1e-7;

// Newton-Raphson is start-sensitive: from the 10% seed, a steep loss (worse than ~-42%
// annualised) overshoots below MIN_RATE on the first step. The 10% seed stays first so every
// case that already converged keeps its exact result; the rest are only tried on failure.
const START_GUESSES = [0.1, -0.5, 1, -0.9, 10];

function newton(guess: number, cashFlows: CashFlow[], d0: Date): number | null {
  let rate = guess;

  for (let i = 0; i < MAX_ITER; i++) {
    const f = npv(rate, cashFlows, d0);
    const fPrime = npvDerivative(rate, cashFlows, d0);

    if (Math.abs(fPrime) < 1e-12) break;

    const newRate = rate - f / fPrime;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate;
    rate = newRate;

    // Guard against divergence
    if (rate < MIN_RATE || rate > MAX_RATE) return null;
  }

  // Check if converged
  const finalNpv = npv(rate, cashFlows, d0);
  return Math.abs(finalNpv) < 0.01 ? rate : null;
}

/** Last resort: bisect over [MIN_RATE, MAX_RATE] when NPV changes sign across it. */
function bisect(cashFlows: CashFlow[], d0: Date): number | null {
  let lo = MIN_RATE;
  let hi = MAX_RATE;
  const fLo = npv(lo, cashFlows, d0);
  const fHi = npv(hi, cashFlows, d0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;

  for (let i = 0; i < 200 && hi - lo > TOLERANCE; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashFlows, d0);
    if (fMid * fLo > 0) lo = mid;
    else hi = mid;
  }
  const rate = (lo + hi) / 2;
  return Math.abs(npv(rate, cashFlows, d0)) < 0.01 ? rate : null;
}

export function calculateXIRR(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  const hasNeg = cashFlows.some(cf => cf.amount < 0);
  const hasPos = cashFlows.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const d0 = cashFlows.reduce((min, cf) => (cf.date < min ? cf.date : min), cashFlows[0].date);

  for (const guess of START_GUESSES) {
    const rate = newton(guess, cashFlows, d0);
    if (rate !== null) return rate;
  }
  return bisect(cashFlows, d0);
}

export type { CashFlow };
