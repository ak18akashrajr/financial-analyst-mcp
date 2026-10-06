// Unit tests for calculateXIRR (Newton-Raphson XIRR solver). See src/lib/xirr.ts.
import { describe, expect, it } from 'vitest';
import { calculateXIRR, type CashFlow } from '@/lib/xirr';

const days = (n: number) => n * 24 * 60 * 60 * 1000;

/** Recompute NPV at the given rate the same way the module does internally, to
 * independently verify convergence rather than pinning to one hardcoded expected rate. */
function npvAt(rate: number, cashFlows: CashFlow[]): number {
  const d0 = cashFlows.reduce((min, cf) => (cf.date < min ? cf.date : min), cashFlows[0].date);
  return cashFlows.reduce((sum, cf) => {
    const years = (cf.date.getTime() - d0.getTime()) / days(1) / 365;
    return sum + cf.amount / Math.pow(1 + rate, years);
  }, 0);
}

describe('calculateXIRR', () => {
  it('returns null with fewer than 2 cash flows', () => {
    expect(calculateXIRR([])).toBeNull();
    expect(calculateXIRR([{ amount: -1000, date: new Date('2024-01-01') }])).toBeNull();
  });

  it('returns null when all cash flows are outflows', () => {
    const cfs: CashFlow[] = [
      { amount: -1000, date: new Date('2024-01-01') },
      { amount: -500, date: new Date('2024-06-01') },
    ];
    expect(calculateXIRR(cfs)).toBeNull();
  });

  it('returns null when all cash flows are inflows', () => {
    const cfs: CashFlow[] = [
      { amount: 1000, date: new Date('2024-01-01') },
      { amount: 500, date: new Date('2024-06-01') },
    ];
    expect(calculateXIRR(cfs)).toBeNull();
  });

  it('solves the textbook case: invest 1000, receive 1100 exactly one year later → 10%', () => {
    const d0 = new Date('2023-01-01T00:00:00Z');
    const d1 = new Date(d0.getTime() + days(365)); // exactly 365 days = 1.0 year in this module's day-count
    const cfs: CashFlow[] = [
      { amount: -1000, date: d0 },
      { amount: 1100, date: d1 },
    ];
    const rate = calculateXIRR(cfs);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 5);
  });

  it('solves a loss scenario to a negative rate', () => {
    const d0 = new Date('2023-01-01T00:00:00Z');
    const d1 = new Date(d0.getTime() + days(365));
    const cfs: CashFlow[] = [
      { amount: -1000, date: d0 },
      { amount: 800, date: d1 },
    ];
    const rate = calculateXIRR(cfs);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(0);
    expect(Math.abs(npvAt(rate!, cfs))).toBeLessThan(0.01);
  });

  // Regression: Newton from the 10% seed overshoots below the -0.99 divergence guard on
  // steep losses and the solver used to give up with null instead of trying another start.
  describe('large annualised losses (worse than ~-42%)', () => {
    const d0 = new Date('2023-01-01T00:00:00Z');
    const twoFlow = (out: number, back: number, nDays: number): CashFlow[] => [
      { amount: -out, date: d0 },
      { amount: back, date: new Date(d0.getTime() + days(nDays)) },
    ];

    it.each([
      ['365d 1000→600 (−40%)', 1000, 600, 365, -0.4],
      ['365d 1000→550 (−45%)', 1000, 550, 365, -0.45],
      ['365d 1000→500 (−50%)', 1000, 500, 365, -0.5],
      ['365d 1000→100 (−90%)', 1000, 100, 365, -0.9],
      ['30d 1000→900', 1000, 900, 30, Math.pow(0.9, 365 / 30) - 1],
      ['90d 1000→800', 1000, 800, 90, Math.pow(0.8, 365 / 90) - 1],
    ])('%s solves to the closed-form rate', (_label, out, back, nDays, expected) => {
      const rate = calculateXIRR(twoFlow(out, back, nDays));
      expect(rate).not.toBeNull();
      expect(rate!).toBeCloseTo(expected, 5);
    });

    it('solves a steep loss with an intermediate contribution', () => {
      const cfs: CashFlow[] = [
        { amount: -1000, date: d0 },
        { amount: -1000, date: new Date(d0.getTime() + days(180)) },
        { amount: 700, date: new Date(d0.getTime() + days(365)) },
      ];
      const rate = calculateXIRR(cfs);
      expect(rate).not.toBeNull();
      expect(rate!).toBeLessThan(-0.5);
      expect(Math.abs(npvAt(rate!, cfs))).toBeLessThan(0.01);
    });
  });

  it('converges (NPV ≈ 0 at the solved rate) for irregular multi-flow cash flows', () => {
    const d0 = new Date('2023-01-01T00:00:00Z');
    const cfs: CashFlow[] = [
      { amount: -1000, date: d0 },
      { amount: -500, date: new Date(d0.getTime() + days(90)) },
      { amount: 2000, date: new Date(d0.getTime() + days(400)) },
    ];
    const rate = calculateXIRR(cfs);
    expect(rate).not.toBeNull();
    expect(Math.abs(npvAt(rate!, cfs))).toBeLessThan(0.01);
  });

  it('is order-independent — shuffling the same cash flows yields the same rate', () => {
    const d0 = new Date('2023-01-01T00:00:00Z');
    const cfs: CashFlow[] = [
      { amount: -1000, date: d0 },
      { amount: -500, date: new Date(d0.getTime() + days(90)) },
      { amount: 2000, date: new Date(d0.getTime() + days(400)) },
    ];
    const reordered = [cfs[2], cfs[0], cfs[1]];
    expect(calculateXIRR(reordered)!).toBeCloseTo(calculateXIRR(cfs)!, 6);
  });
});
