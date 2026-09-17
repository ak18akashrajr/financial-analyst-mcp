// Covers src/lib/familyMemberDisplay.ts, which resolves the seeded "Self" family_members row
// (name/relationship both literally "Self" — see migration 20260917100000_add_family_members.sql)
// to the actual owner's name everywhere a member's display name is shown (greeting, footer, etc.),
// rather than showing the DB label "Self" verbatim.
import { describe, expect, it } from 'vitest';
import { getMemberDisplayName, SELF_DISPLAY_NAME } from '@/lib/familyMemberDisplay';

describe('getMemberDisplayName', () => {
  it('shows "Akash" for the seeded Self member instead of the literal DB name', () => {
    expect(getMemberDisplayName({ name: 'Self', relationship: 'Self' })).toBe(SELF_DISPLAY_NAME);
  });

  it('shows the actual name for a non-self family member', () => {
    expect(getMemberDisplayName({ name: 'Priya', relationship: 'Spouse' })).toBe('Priya');
  });

  it('falls back to "Akash" when no member is given (e.g. the combined "All Family" view)', () => {
    expect(getMemberDisplayName(null)).toBe(SELF_DISPLAY_NAME);
    expect(getMemberDisplayName(undefined)).toBe(SELF_DISPLAY_NAME);
  });
});
