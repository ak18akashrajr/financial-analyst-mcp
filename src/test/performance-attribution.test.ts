import { describe, expect, it } from 'vitest';
import { computePerformanceAttribution } from '@/lib/performanceAttribution';
import type { DerivedHolding } from '@/types/portfolio';

function makeHolding(overrides: Partial<DerivedHolding>): DerivedHolding {
  return {
    symbol: 'TCS',
    totalQuantity: 10,
    totalInvested: 100000,
    avgPrice: 10000,
    currentPrice: 11000,
    currentValue: 110000,
    pnl: 10000,
    pnlPercent: 10,
    transactions: [],
    ...overrides,
  };
}

describe('computePerformanceAttribution', () => {
  it('returns an empty array when there are no holdings', () => {
    expect(computePerformanceAttribution([])).toEqual([]);
  });

  it('returns an empty array when total invested is zero (avoids divide-by-zero)', () => {
    const holdings = [makeHolding({ symbol: 'TCS', totalInvested: 0, pnl: 0 })];
    expect(computePerformanceAttribution(holdings)).toEqual([]);
  });

  it('computes each holding\'s contribution as its P&L over TOTAL invested capital, not its own', () => {
    const holdings = [
      makeHolding({ symbol: 'TCS', totalInvested: 100000, pnl: 20000, pnlPercent: 20 }),
      makeHolding({ symbol: 'HDFC', totalInvested: 300000, pnl: -30000, pnlPercent: -10 }),
    ];
    const result = computePerformanceAttribution(holdings);
    // total invested = 400000
    const tcs = result.find((r) => r.symbol === 'TCS')!;
    const hdfc = result.find((r) => r.symbol === 'HDFC')!;
    expect(tcs.contributionPercent).toBeCloseTo((20000 / 400000) * 100, 5); // 5
    expect(hdfc.contributionPercent).toBeCloseTo((-30000 / 400000) * 100, 5); // -7.5
    // Own-return % is preserved separately for context, unchanged from the input.
    expect(tcs.pnlPercent).toBe(20);
    expect(hdfc.pnlPercent).toBe(-10);
  });

  it('contribution percentages sum to the portfolio\'s overall P&L percent', () => {
    const holdings = [
      makeHolding({ symbol: 'A', totalInvested: 100000, pnl: 15000 }),
      makeHolding({ symbol: 'B', totalInvested: 200000, pnl: -5000 }),
      makeHolding({ symbol: 'C', totalInvested: 50000, pnl: 2500 }),
    ];
    const totalInvested = 350000;
    const totalPnl = 15000 - 5000 + 2500;
    const overallPnlPercent = (totalPnl / totalInvested) * 100;

    const result = computePerformanceAttribution(holdings);
    const summed = result.reduce((s, r) => s + r.contributionPercent, 0);
    expect(summed).toBeCloseTo(overallPnlPercent, 8);
  });

  it('sorts by contribution percent descending, biggest driver first', () => {
    const holdings = [
      makeHolding({ symbol: 'SMALL_GAIN', totalInvested: 100000, pnl: 1000 }),
      makeHolding({ symbol: 'BIG_LOSS', totalInvested: 100000, pnl: -20000 }),
      makeHolding({ symbol: 'BIG_GAIN', totalInvested: 100000, pnl: 30000 }),
    ];
    const result = computePerformanceAttribution(holdings);
    expect(result.map((r) => r.symbol)).toEqual(['BIG_GAIN', 'SMALL_GAIN', 'BIG_LOSS']);
  });

  it('carries currentValue through unchanged for display/tooltip use', () => {
    const holdings = [makeHolding({ symbol: 'TCS', currentValue: 123456 })];
    const result = computePerformanceAttribution(holdings);
    expect(result[0].currentValue).toBe(123456);
  });
});
