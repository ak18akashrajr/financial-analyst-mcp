import type { FamilyMember } from '@/types/portfolio';

// The seed row from the family_members migration is named/relationship'd literally "Self"
// (20260917100000_add_family_members.sql) — that's a DB label, not something to show in the
// UI, so it's swapped for the actual owner's name everywhere a member's display name is used.
export const SELF_DISPLAY_NAME = 'Akash';

export function getMemberDisplayName(member: Pick<FamilyMember, 'name' | 'relationship'> | null | undefined): string {
  if (!member || member.relationship === 'Self') return SELF_DISPLAY_NAME;
  return member.name;
}
