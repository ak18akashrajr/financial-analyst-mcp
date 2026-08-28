import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocalDate, todayLocalDateString } from '@/lib/dateUtils';

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

describe('todayLocalDateString', () => {
  afterEach(() => vi.useRealTimers());

  it('matches the local calendar date, not the UTC one, in the early hours after local midnight', () => {
    const offsetMinutes = -new Date().getTimezoneOffset(); // e.g. +330 for IST
    if (offsetMinutes <= 0) return; // only meaningful in a timezone ahead of UTC (this suite runs under IST)

    // 1:00 AM local time on Aug 28 — still Aug 27 in UTC in any timezone at least 1hr ahead.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 1, 0, 0));

    expect(todayLocalDateString()).toBe('2026-08-28'); // local date, not '2026-08-27' (the UTC date)
    expect(todayLocalDateString()).not.toBe(new Date().toISOString().split('T')[0]);
  });

  it('zero-pads single-digit month/day to match the DATE-column string shape', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5)); // Jan 5
    expect(todayLocalDateString()).toBe('2026-01-05');
  });
});
