// Unit tests for the years-to-double helper backing TODO.md's "XIRR → time-to-double" —
// exact ln(2)/ln(1+rate), not the Rule-of-72 mental-math approximation. See src/lib/timeToDouble.ts.
import { describe, expect, it } from 'vitest';
import { formatYearsToDouble, yearsToDouble } from '@/lib/timeToDouble';

describe('yearsToDouble', () => {
  it('computes ln(2)/ln(1+rate) for a positive rate', () => {
    // 12% annualized doubles in ~6.12 years (vs. Rule of 72's rough 72/12 = 6.0).
    expect(yearsToDouble(0.12)).toBeCloseTo(6.1163, 3);
  });

  it('is close to the Rule-of-72 approximation for typical equity-like rates', () => {
    const exact = yearsToDouble(0.08)!;
    const ruleOf72 = 72 / 8;
    expect(exact).toBeCloseTo(ruleOf72, 0); // within a year — it's an approximation
  });

  it('returns null for a zero rate — never doubles', () => {
    expect(yearsToDouble(0)).toBeNull();
  });

  it('returns null for a negative rate — shrinking, not doubling', () => {
    expect(yearsToDouble(-0.05)).toBeNull();
  });

  it('returns null for a total-loss rate (xirr <= -1)', () => {
    expect(yearsToDouble(-1)).toBeNull();
    expect(yearsToDouble(-1.5)).toBeNull();
  });

  it('returns null for null/undefined/non-finite input', () => {
    expect(yearsToDouble(null)).toBeNull();
    expect(yearsToDouble(undefined)).toBeNull();
    expect(yearsToDouble(NaN)).toBeNull();
    expect(yearsToDouble(Infinity)).toBeNull();
  });
});

describe('formatYearsToDouble', () => {
  it('formats a null duration as an em dash', () => {
    expect(formatYearsToDouble(null)).toBe('—');
  });

  it('formats a multi-year duration in years', () => {
    expect(formatYearsToDouble(6.1163)).toBe('6.1y to double');
  });

  it('formats a sub-year duration in months', () => {
    expect(formatYearsToDouble(0.5)).toBe('6.0mo to double');
  });
});
