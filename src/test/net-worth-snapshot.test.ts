import { describe, expect, it } from 'vitest';
import {
  NET_WORTH_CHANGE_EPSILON,
  isSameIstCalendarDay,
  shouldSkipNetWorthSnapshot,
  type NetWorthSnapshotFields,
} from '@/lib/netWorthSnapshot';

const base: NetWorthSnapshotFields = {
  netWorth: 100000,
  portfolioValue: 80000,
  liquidCash: 15000,
  vaultCash: 5000,
  pfBalance: 0,
  creditCardDebt: 0,
};

describe('shouldSkipNetWorthSnapshot', () => {
  it('never skips when there is no snapshot from today yet', () => {
    expect(shouldSkipNetWorthSnapshot(base, null)).toBe(false);
  });

  it('skips an insert that would be identical to today\'s most recent snapshot', () => {
    expect(shouldSkipNetWorthSnapshot(base, { ...base })).toBe(true);
  });

  it('treats a sub-epsilon difference as float noise, not a real change', () => {
    const candidate = { ...base, netWorth: base.netWorth + NET_WORTH_CHANGE_EPSILON / 2 };
    expect(shouldSkipNetWorthSnapshot(candidate, base)).toBe(true);
  });

  it('does not skip when any single field genuinely moved', () => {
    const candidate = { ...base, liquidCash: base.liquidCash + 500 };
    expect(shouldSkipNetWorthSnapshot(candidate, base)).toBe(false);
  });

  it('does not skip a real change right at the epsilon boundary', () => {
    const candidate = { ...base, netWorth: base.netWorth + NET_WORTH_CHANGE_EPSILON + 0.01 };
    expect(shouldSkipNetWorthSnapshot(candidate, base)).toBe(false);
  });
});

describe('isSameIstCalendarDay', () => {
  it('treats two timestamps on the same IST calendar day as equal, even across a UTC midnight', () => {
    // 2026-08-22T20:00:00Z is 2026-08-23 01:30 IST — still "today" relative to 2026-08-23T00:00:00Z.
    const a = new Date('2026-08-22T20:00:00.000Z');
    const b = new Date('2026-08-23T00:00:00.000Z');
    expect(isSameIstCalendarDay(a, b)).toBe(true);
  });

  it('treats timestamps on different IST calendar days as different', () => {
    const a = new Date('2026-08-21T10:00:00.000Z');
    const b = new Date('2026-08-22T10:00:00.000Z');
    expect(isSameIstCalendarDay(a, b)).toBe(false);
  });
});
