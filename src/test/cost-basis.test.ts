// Unit tests for the FIFO cost-basis helper shared by usePortfolio.ts and
// periodReports.ts. See src/lib/costBasis.ts for the bug this replaces:
// invested used to be reduced by a SELL's proceeds (qty × sell price)
// instead of the cost basis of the shares actually sold.
import { describe, expect, it } from 'vitest';
import { computeFifoPosition } from '@/lib/costBasis';
import type { Transaction } from '@/types/portfolio';

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), symbol: 'SYM', type: 'BUY', quantity: 1, price: 1, date: '2026-01-01', ...overrides };
}

describe('computeFifoPosition', () => {
  it('returns zeros for no transactions', () => {
    const pos = computeFifoPosition([]);
    expect(pos).toEqual({ totalQuantity: 0, totalInvested: 0, avgPrice: 0, openLots: [] });
  });

  it('accumulates a single BUY lot', () => {
    const pos = computeFifoPosition([txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' })]);
    expect(pos.totalQuantity).toBe(10);
    expect(pos.totalInvested).toBe(1000);
    expect(pos.avgPrice).toBe(100);
  });

  it('does NOT let a profitable partial sell inflate the remaining position (the original bug)', () => {
    // Buy 10 @ ₹100, sell 5 @ ₹180. The old formula computed
    // invested = 1000 − (5×180) = 100, avgPrice = 100/5 = ₹20 — wrong.
    // FIFO: the 5 remaining shares are still costed at ₹100 each.
    const pos = computeFifoPosition([
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
      txn({ type: 'SELL', quantity: 5, price: 180, date: '2026-05-01' }),
    ]);
    expect(pos.totalQuantity).toBe(5);
    expect(pos.totalInvested).toBe(500);
    expect(pos.avgPrice).toBe(100);
  });

  it('does NOT let a loss-making partial sell deflate the remaining position', () => {
    // Buy 10 @ ₹100, sell 5 @ ₹40. Old formula: invested = 1000 − 200 = 800,
    // avgPrice = 800/5 = ₹160 — wrong (inflates apparent avg cost/loss).
    const pos = computeFifoPosition([
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
      txn({ type: 'SELL', quantity: 5, price: 40, date: '2026-05-01' }),
    ]);
    expect(pos.totalQuantity).toBe(5);
    expect(pos.totalInvested).toBe(500);
    expect(pos.avgPrice).toBe(100);
  });

  it('depletes the oldest lot first when there are two BUY lots at different prices', () => {
    // Buy 10 @ ₹100, buy 10 @ ₹200, sell 10 → FIFO consumes the ₹100 lot first,
    // leaving 10 shares from the ₹200 lot (invested ₹2,000, not a ₹1,500 blended average).
    const pos = computeFifoPosition([
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
      txn({ type: 'BUY', quantity: 10, price: 200, date: '2026-05-01' }),
      txn({ type: 'SELL', quantity: 10, price: 250, date: '2026-06-01' }),
    ]);
    expect(pos.totalQuantity).toBe(10);
    expect(pos.totalInvested).toBe(2000);
    expect(pos.avgPrice).toBe(200);
  });

  it('partially depletes a lot when the sell only eats into part of it', () => {
    const pos = computeFifoPosition([
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
      txn({ type: 'BUY', quantity: 10, price: 200, date: '2026-05-01' }),
      txn({ type: 'SELL', quantity: 12, price: 250, date: '2026-06-01' }),
    ]);
    // Consumes all 10 of the ₹100 lot, then 2 of the ₹200 lot → 8 remain @ ₹200.
    expect(pos.totalQuantity).toBe(8);
    expect(pos.totalInvested).toBe(1600);
    expect(pos.avgPrice).toBe(200);
  });

  it('sorts out-of-order transactions by date before applying FIFO', () => {
    const pos = computeFifoPosition([
      txn({ type: 'SELL', quantity: 5, price: 180, date: '2026-05-01' }),
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
    ]);
    expect(pos.totalQuantity).toBe(5);
    expect(pos.totalInvested).toBe(500);
  });

  it('fully depletes to zero on a full sell', () => {
    const pos = computeFifoPosition([
      txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-04-01' }),
      txn({ type: 'SELL', quantity: 10, price: 150, date: '2026-05-01' }),
    ]);
    expect(pos.totalQuantity).toBe(0);
    expect(pos.totalInvested).toBe(0);
    expect(pos.avgPrice).toBe(0);
    expect(pos.openLots).toEqual([]);
  });
});
