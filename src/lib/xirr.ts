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

export function calculateXIRR(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  const hasNeg = cashFlows.some(cf => cf.amount < 0);
  const hasPos = cashFlows.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const d0 = cashFlows.reduce((min, cf) => (cf.date < min ? cf.date : min), cashFlows[0].date);

  let rate = 0.1; // initial guess 10%
  const maxIter = 100;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIter; i++) {
    const f = npv(rate, cashFlows, d0);
    const fPrime = npvDerivative(rate, cashFlows, d0);

    if (Math.abs(fPrime) < 1e-12) break;

    const newRate = rate - f / fPrime;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;

    // Guard against divergence
    if (rate < -0.99 || rate > 100) return null;
  }

  // Check if converged
  const finalNpv = npv(rate, cashFlows, d0);
  return Math.abs(finalNpv) < 0.01 ? rate : null;
}

export type { CashFlow };
