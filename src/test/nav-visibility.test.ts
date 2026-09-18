// Covers hiding advanced/technical pages from the nav when the active family member is tagged
// "Parent" — Dev Zone (debug/diagnostic tooling) plus Benchmark, Rolling, Risk Metrics, and
// Forecast (analytics aimed at someone actively managing the portfolio) only confuse a parent
// checking their own numbers. This is a UX declutter, not access control: every one of these
// routes stays reachable by URL (see navConfig.ts's doc comment on getVisibleNavGroups).
import { describe, expect, it } from 'vitest';
import { getVisibleNavGroups, navGroups } from '@/components/navConfig';

const HIDDEN_FOR_PARENT = ['/dev-zone', '/benchmark', '/rolling-returns', '/risk-metrics', '/forecast'];

function findItem(groups: ReturnType<typeof getVisibleNavGroups>, to: string) {
  for (const g of groups) {
    const found = g.items.find((i) => i.to === to);
    if (found) return found;
  }
  return undefined;
}

describe('getVisibleNavGroups', () => {
  it('shows every item, including the Parent-hidden ones, for the combined "All Family" view (null relationship)', () => {
    const groups = getVisibleNavGroups(null);
    for (const to of HIDDEN_FOR_PARENT) expect(findItem(groups, to)).toBeDefined();
    expect(groups).toEqual(navGroups);
  });

  it('shows every item for a non-Parent member (e.g. Self, Spouse, Child)', () => {
    for (const relationship of ['Self', 'Spouse', 'Child']) {
      const groups = getVisibleNavGroups(relationship);
      for (const to of HIDDEN_FOR_PARENT) expect(findItem(groups, to)).toBeDefined();
    }
  });

  it('hides Dev Zone, Benchmark, Rolling, Risk Metrics, and Forecast for a member tagged "Parent"', () => {
    const groups = getVisibleNavGroups('Parent');
    for (const to of HIDDEN_FOR_PARENT) expect(findItem(groups, to)).toBeUndefined();
    // Everything else stays — this only strips the specific hidden items.
    expect(findItem(groups, '/overview')).toBeDefined();
    expect(findItem(groups, '/charts')).toBeDefined();
    expect(findItem(groups, '/reports')).toBeDefined();
    expect(findItem(groups, '/dollar-adjusted-returns')).toBeDefined();
    expect(findItem(groups, '/taxes')).toBeDefined();
    expect(findItem(groups, '/projections')).toBeDefined();
    expect(findItem(groups, '/deployment-plan')).toBeDefined();
    expect(findItem(groups, '/goal-track')).toBeDefined();
    expect(findItem(groups, '/ai')).toBeDefined();
    expect(findItem(groups, '/family-members')).toBeDefined();
  });

  it('never leaves behind an empty group after filtering', () => {
    const groups = getVisibleNavGroups('Parent');
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    // The Analytics group specifically loses 3 of its 6 items (Benchmark, Rolling, Risk
    // Metrics) but shouldn't disappear entirely — Charts/Reports/USD View remain.
    const analytics = groups.find((g) => g.label === 'Analytics');
    expect(analytics?.items).toHaveLength(3);
  });
});
