import { describe, expect, it } from 'vitest';
import { parseLocalDate } from '@/lib/dateUtils';

describe('parseLocalDate', () => {
  it('builds local midnight for a date-only string, matching new Date(y, m, d)', () => {
    expect(parseLocalDate('2026-07-01')).toEqual(new Date(2026, 6, 1));
    expect(parseLocalDate('2026-01-31')).toEqual(new Date(2026, 0, 31));
  });

  it('differs from the built-in UTC parse of the same string in a positive-UTC-offset timezone', () => {
    // This is the exact discrepancy that caused periodReports.ts to silently drop
    // same-day historical closes / transactions at period boundaries. Only meaningful
    // in a timezone ahead of UTC (this suite runs under Asia/Calcutta, UTC+5:30) —
    // guard so the assertion doesn't misfire if CI ever runs in UTC.
    const offsetMinutes = -new Date().getTimezoneOffset(); // e.g. +330 for IST
    if (offsetMinutes <= 0) return;
    expect(parseLocalDate('2026-07-01').getTime()).toBeLessThan(new Date('2026-07-01').getTime());
  });

  it('leaves a full ISO timestamp alone — it already carries a real offset', () => {
    // Unlike a bare DATE string, this already encodes a specific instant; reinterpreting
    // its date portion as local would silently shift it (this is what test fixtures built
    // via `new Date(...).toISOString()` rely on — see reports-page.test.tsx / period-reports.test.ts).
    expect(parseLocalDate('2026-07-01T00:00:00.000Z')).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });
});
