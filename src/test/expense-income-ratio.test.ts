// Unit tests for the pure helpers backing the auto-tracked Expense-to-Income
// Ratio feature (see TODO.md and src/lib/expenseIncomeRatio.ts). Pure/DB-free
// on purpose — same pattern as net-worth-snapshot.test.ts for netWorthSnapshot.ts.
import { describe, expect, it } from 'vitest';
import {
  classifyBalanceDelta,
  computeExpenseToIncomeRatio,
  expenseToIncomeZone,
  getIstYearMonth,
} from '@/lib/expenseIncomeRatio';

describe('classifyBalanceDelta', () => {
  it('treats an increase as income', () => {
    expect(classifyBalanceDelta(1000, 1500)).toEqual({ income: 500, expense: 0 });
  });

  it('treats a decrease as an expense, magnitude only', () => {
    expect(classifyBalanceDelta(1500, 1000)).toEqual({ income: 0, expense: 500 });
  });

  it('is a no-op when the balance is unchanged', () => {
    expect(classifyBalanceDelta(1000, 1000)).toEqual({ income: 0, expense: 0 });
  });
});

describe('computeExpenseToIncomeRatio', () => {
  it('divides expense by income and multiplies by 100', () => {
    expect(computeExpenseToIncomeRatio(2500, 5000)).toBe(50);
  });

  it('returns null when there is no income yet this month (undefined, not divide-by-zero)', () => {
    expect(computeExpenseToIncomeRatio(1000, 0)).toBeNull();
    expect(computeExpenseToIncomeRatio(0, 0)).toBeNull();
  });

  it('allows a ratio over 100% when expenses exceed income', () => {
    expect(computeExpenseToIncomeRatio(6000, 5000)).toBe(120);
  });
});

describe('expenseToIncomeZone', () => {
  it('bands under 50% as Ideal', () => {
    expect(expenseToIncomeZone(49.9).label).toBe('Ideal');
    expect(expenseToIncomeZone(0).label).toBe('Ideal');
  });

  it('bands 50%–75% inclusive as Manageable', () => {
    expect(expenseToIncomeZone(50).label).toBe('Manageable');
    expect(expenseToIncomeZone(65).label).toBe('Manageable');
    expect(expenseToIncomeZone(75).label).toBe('Manageable');
  });

  it('bands above 75% as High Risk', () => {
    expect(expenseToIncomeZone(75.1).label).toBe('High Risk');
    expect(expenseToIncomeZone(150).label).toBe('High Risk');
  });
});

describe('getIstYearMonth', () => {
  it('formats a date as an IST YYYY-MM key', () => {
    // 2026-08-26T20:00:00Z is 2026-08-27 01:30 IST — still August in UTC but
    // already the next calendar day in IST; year-month is unaffected here.
    expect(getIstYearMonth(new Date('2026-08-26T20:00:00Z'))).toBe('2026-08');
  });

  it('rolls over to the next IST month when UTC is still the previous month', () => {
    // 2026-07-31T20:00:00Z (UTC) is 2026-08-01T01:30 IST — the IST month key
    // must read August even though the UTC date is still July.
    expect(getIstYearMonth(new Date('2026-07-31T20:00:00Z'))).toBe('2026-08');
  });
});
