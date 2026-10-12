// istDayOf (src/lib/dateUtils.ts): the IST calendar day of a stored date. The client counterpart of txnDayIst in
// supabase/functions/_shared/portfolio-data.ts. transactions.date is a timestamptz, which Postgres returns in UTC.
import { describe, expect, it } from 'vitest';
import { istDayOf } from '@/lib/dateUtils';

describe('istDayOf', () => {
  it('passes a bare date through unchanged', () => {
    expect(istDayOf('2026-09-30')).toBe('2026-09-30');
  });

  it('converts a UTC timestamp to its IST day: 20:30Z is 02:00 IST the next day', () => {
    expect(istDayOf('2026-09-30T20:30:00+00:00')).toBe('2026-10-01');
    expect(istDayOf('2026-09-30T14:00:00+00:00')).toBe('2026-09-30'); // 19:30 IST, same day
  });

  it('rolls over exactly at 18:30 UTC (midnight IST)', () => {
    expect(istDayOf('2026-09-30T18:29:59.999Z')).toBe('2026-09-30');
    expect(istDayOf('2026-09-30T18:30:00.000Z')).toBe('2026-10-01');
  });

  it('handles an explicit offset the same as the equivalent UTC instant', () => {
    expect(istDayOf('2026-10-01T02:00:00+05:30')).toBe('2026-10-01');
    expect(istDayOf('2026-09-30T23:59:00-05:00')).toBe('2026-10-01'); // 04:59Z + 5:30 = 10:29 IST on Oct 1
  });

  it('falls back to the date prefix for something unparseable instead of throwing', () => {
    expect(istDayOf('2026-09-30 garbage')).toBe('2026-09-30');
  });
});
