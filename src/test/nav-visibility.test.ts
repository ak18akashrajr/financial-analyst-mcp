// Covers hiding "Dev Zone" from the nav when the active family member is tagged "Parent" — it's
// debug/diagnostic tooling that only confuses a parent checking their own numbers. This is a UX
// declutter, not access control: the /dev-zone route itself and SecurityIncidentBanner's link to
// it are untouched (see navConfig.ts's doc comment on getVisibleNavGroups).
import { describe, expect, it } from 'vitest';
import { getVisibleNavGroups, navGroups } from '@/components/navConfig';

function findItem(groups: ReturnType<typeof getVisibleNavGroups>, to: string) {
  for (const g of groups) {
    const found = g.items.find((i) => i.to === to);
    if (found) return found;
  }
  return undefined;
}

describe('getVisibleNavGroups', () => {
  it('shows every item, including Dev Zone, for the combined "All Family" view (null relationship)', () => {
    const groups = getVisibleNavGroups(null);
    expect(findItem(groups, '/dev-zone')).toBeDefined();
    expect(groups).toEqual(navGroups);
  });

  it('shows Dev Zone for a non-Parent member (e.g. Self, Spouse, Child)', () => {
    expect(findItem(getVisibleNavGroups('Self'), '/dev-zone')).toBeDefined();
    expect(findItem(getVisibleNavGroups('Spouse'), '/dev-zone')).toBeDefined();
    expect(findItem(getVisibleNavGroups('Child'), '/dev-zone')).toBeDefined();
  });

  it('hides Dev Zone for a member tagged "Parent"', () => {
    const groups = getVisibleNavGroups('Parent');
    expect(findItem(groups, '/dev-zone')).toBeUndefined();
    // Everything else in the same group stays — this only strips the one item.
    expect(findItem(groups, '/ai')).toBeDefined();
    expect(findItem(groups, '/family-members')).toBeDefined();
  });

  it('never leaves behind an empty group after filtering', () => {
    const groups = getVisibleNavGroups('Parent');
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});
