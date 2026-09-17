import { describe, expect, it } from 'vitest';
import { mergeNetWorthHistories, type NetWorthHistoryRow } from '@/lib/mergeNetWorthHistories';

function row(overrides: Partial<NetWorthHistoryRow> & { familyMemberId: string; recordedAt: string }): NetWorthHistoryRow {
  return {
    netWorth: 0,
    portfolioValue: 0,
    liquidCash: 0,
    vaultCash: 0,
    pfBalance: 0,
    creditCardDebt: 0,
    ...overrides,
  };
}

describe('mergeNetWorthHistories', () => {
  it('returns an empty series for no input', () => {
    expect(mergeNetWorthHistories([])).toEqual([]);
  });

  it('sums a single member\'s own rows unchanged (matches today\'s single-portfolio behavior)', () => {
    const rows = [
      row({ familyMemberId: 'self', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 1000 }),
      row({ familyMemberId: 'self', recordedAt: '2026-01-02T00:00:00.000Z', netWorth: 1200 }),
    ];
    const merged = mergeNetWorthHistories(rows);
    expect(merged.map((r) => r.netWorth)).toEqual([1000, 1200]);
    expect(merged.every((r) => r.familyMemberId === 'all')).toBe(true);
  });

  it('sums two members\' snapshots taken on the same date', () => {
    const rows = [
      row({ familyMemberId: 'a', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 1000 }),
      row({ familyMemberId: 'b', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 500 }),
    ];
    const merged = mergeNetWorthHistories(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].netWorth).toBe(1500);
  });

  it('carries each member\'s last-known snapshot forward onto a date only the other member recorded', () => {
    // Member A snapshots on Jan 1 and Jan 3; member B only on Jan 2 — the merged series must have
    // one point per distinct date across both, with A's Jan 1 figure still counted on Jan 2.
    const rows = [
      row({ familyMemberId: 'a', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 1000 }),
      row({ familyMemberId: 'b', recordedAt: '2026-01-02T00:00:00.000Z', netWorth: 300 }),
      row({ familyMemberId: 'a', recordedAt: '2026-01-03T00:00:00.000Z', netWorth: 1100 }),
    ];
    const merged = mergeNetWorthHistories(rows);
    expect(merged.map((r) => r.recordedAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
    // Jan 2: A's Jan 1 figure (1000, carried forward) + B's own 300.
    expect(merged[1].netWorth).toBe(1300);
    // Jan 3: A's fresh 1100 + B's Jan 2 figure (300, carried forward).
    expect(merged[2].netWorth).toBe(1400);
  });

  it('contributes zero for a member with no snapshot yet as of a given date', () => {
    // Member B joined later (first snapshot Jan 5) — dates before that shouldn't count B at all,
    // not error or contribute NaN.
    const rows = [
      row({ familyMemberId: 'a', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 1000 }),
      row({ familyMemberId: 'b', recordedAt: '2026-01-05T00:00:00.000Z', netWorth: 200 }),
    ];
    const merged = mergeNetWorthHistories(rows);
    expect(merged[0].netWorth).toBe(1000); // just A, on Jan 1
    expect(merged[1].netWorth).toBe(1200); // A carried forward + B's own, on Jan 5
  });

  it('sums every numeric field independently, not just netWorth', () => {
    const rows = [
      row({ familyMemberId: 'a', recordedAt: '2026-01-01T00:00:00.000Z', liquidCash: 100, vaultCash: 50, pfBalance: 10, creditCardDebt: 5 }),
      row({ familyMemberId: 'b', recordedAt: '2026-01-01T00:00:00.000Z', liquidCash: 200, vaultCash: 20, pfBalance: 0, creditCardDebt: 15 }),
    ];
    const [merged] = mergeNetWorthHistories(rows);
    expect(merged.liquidCash).toBe(300);
    expect(merged.vaultCash).toBe(70);
    expect(merged.pfBalance).toBe(10);
    expect(merged.creditCardDebt).toBe(20);
  });

  it('sorts unordered input into ascending date order', () => {
    const rows = [
      row({ familyMemberId: 'a', recordedAt: '2026-01-03T00:00:00.000Z', netWorth: 3 }),
      row({ familyMemberId: 'a', recordedAt: '2026-01-01T00:00:00.000Z', netWorth: 1 }),
      row({ familyMemberId: 'a', recordedAt: '2026-01-02T00:00:00.000Z', netWorth: 2 }),
    ];
    const merged = mergeNetWorthHistories(rows);
    expect(merged.map((r) => r.netWorth)).toEqual([1, 2, 3]);
  });
});
