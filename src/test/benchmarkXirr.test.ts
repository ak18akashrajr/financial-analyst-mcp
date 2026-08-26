// Unit tests for computeBenchmarkXirr — replaying real transactions as index-unit buys/sells.
// See src/lib/benchmarkXirr.ts.
import { describe, expect, it } from 'vitest';
import { computeBenchmarkXirr } from '@/lib/benchmarkXirr';
import type { Transaction } from '@/types/portfolio';

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: 'x', symbol: 'AAPL', type: 'BUY', quantity: 1, price: 100, date: '2023-01-01', ...overrides };
}

describe('computeBenchmarkXirr', () => {
  it('returns null with no transactions or no prices', () => {
    expect(computeBenchmarkXirr([], [{ date: '2023-01-01', close: 100 }]).xirr).toBeNull();
    expect(computeBenchmarkXirr([txn({})], []).xirr).toBeNull();
  });

  it('replays a single BUY into index units and matches the real XIRR for an equivalent single position', () => {
    // Buy ₹1000 worth on day 0 at index price 100 → 10 units. A year later the index is at 110 →
    // terminal value 1100. This is the exact 1000→1100-in-a-year case the xirr.test.ts textbook
    // case solves to 10%, so the two engines should agree.
    const txns: Transaction[] = [txn({ type: 'BUY', quantity: 10, price: 100, date: '2023-01-01' })];
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];
    const asOf = new Date('2024-01-01T00:00:00Z');
    const result = computeBenchmarkXirr(txns, prices, asOf);
    expect(result.xirr).not.toBeNull();
    expect(result.xirr!).toBeCloseTo(0.1, 2);
    expect(result.excludedCount).toBe(0);
  });

  it('excludes transactions older than the earliest available benchmark price and reports the count', () => {
    const txns: Transaction[] = [
      txn({ date: '2020-01-01', quantity: 5, price: 100 }), // before price coverage starts
      txn({ date: '2023-06-01', quantity: 5, price: 100 }),
    ];
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-12-31', close: 120 },
    ];
    const result = computeBenchmarkXirr(txns, prices, new Date('2024-01-01T00:00:00Z'));
    expect(result.excludedCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.earliestAvailableDate).toBe('2023-01-01');
    expect(result.earliestNeededDate).toBe('2020-01-01');
  });

  it('a SELL reduces the running unit count and its proceeds flow in at the sale date', () => {
    const txns: Transaction[] = [
      txn({ type: 'BUY', date: '2023-01-01', quantity: 20, price: 100 }), // 20 units @ price 100 = 20 units
      txn({ type: 'SELL', date: '2023-06-01', quantity: 10, price: 110 }), // ₹1100 sold at index price 110 → -10 units
    ];
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-06-01', close: 110 },
      { date: '2024-01-01', close: 130 },
    ];
    const result = computeBenchmarkXirr(txns, prices, new Date('2024-01-01T00:00:00Z'));
    // Remaining units: 20 - 10 = 10, terminal value = 10 * 130 = 1300 > 0, so XIRR should solve.
    expect(result.xirr).not.toBeNull();
  });

  it('omits the terminal flow (rather than a negative one) when the replayed position nets to zero or below', () => {
    const txns: Transaction[] = [
      txn({ type: 'BUY', date: '2023-01-01', quantity: 5, price: 100 }),
      // Sells more ₹ than were ever bought via the index replay — deliberately pathological.
      txn({ type: 'SELL', date: '2023-02-01', quantity: 50, price: 100 }),
    ];
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2024-01-01', close: 120 },
    ];
    const result = computeBenchmarkXirr(txns, prices, new Date('2024-01-01T00:00:00Z'));
    // Cash flows are both positive (one BUY outflow, one large SELL inflow, no terminal flow) —
    // calculateXIRR should reject this (no negative flow after the first) rather than return a
    // fabricated rate.
    expect(result.xirr).toBeNull();
  });
});
