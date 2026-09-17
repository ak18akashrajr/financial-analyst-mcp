// Rolls up multiple family members' independent net_worth_history rows into one combined
// household series, for the "All Family" view. Each member snapshots on their own schedule
// (recordNetWorthSnapshot only fires when THEIR transactions/cash change — see usePortfolio.ts),
// so members' recorded dates don't line up. This carries each member's last-known figures
// forward to every date any member has a snapshot on, then sums across members — the standard
// "as-of" rollup for independently-sampled time series.
//
// Pure and DB-free on purpose, same convention as netWorthSnapshot.ts, so this is unit-testable
// without a live Supabase connection.

export interface NetWorthHistoryRow {
  familyMemberId: string;
  recordedAt: string; // ISO timestamp
  netWorth: number;
  portfolioValue: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
}

const NUMERIC_FIELDS = ['netWorth', 'portfolioValue', 'liquidCash', 'vaultCash', 'pfBalance', 'creditCardDebt'] as const;

/**
 * `rows` may be in any order and span any number of members. Returns one combined row per
 * distinct `recordedAt` present in the input, sorted ascending, with `familyMemberId: 'all'`.
 * A member who has no snapshot yet as of a given date contributes 0 to every field for that
 * date (they simply didn't exist yet, financially, from this app's point of view).
 */
export function mergeNetWorthHistories(rows: NetWorthHistoryRow[]): NetWorthHistoryRow[] {
  if (rows.length === 0) return [];

  const byMember = new Map<string, NetWorthHistoryRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.familyMemberId) ?? [];
    list.push(row);
    byMember.set(row.familyMemberId, list);
  }
  for (const list of byMember.values()) {
    list.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }

  const allDates = [...new Set(rows.map((r) => r.recordedAt))].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  // Per-member cursor into their own sorted list, advanced as `allDates` moves forward — O(rows)
  // total across the whole merge, not O(dates × rows).
  const cursors = new Map<string, number>();
  for (const memberId of byMember.keys()) cursors.set(memberId, -1);

  return allDates.map((date) => {
    const dateMs = new Date(date).getTime();
    const combined: NetWorthHistoryRow = {
      familyMemberId: 'all',
      recordedAt: date,
      netWorth: 0,
      portfolioValue: 0,
      liquidCash: 0,
      vaultCash: 0,
      pfBalance: 0,
      creditCardDebt: 0,
    };

    for (const [memberId, list] of byMember) {
      let cursor = cursors.get(memberId)!;
      while (cursor + 1 < list.length && new Date(list[cursor + 1].recordedAt).getTime() <= dateMs) {
        cursor += 1;
      }
      cursors.set(memberId, cursor);
      if (cursor < 0) continue; // this member has no snapshot at or before this date yet

      const latest = list[cursor];
      for (const field of NUMERIC_FIELDS) {
        combined[field] += latest[field];
      }
    }

    return combined;
  });
}
