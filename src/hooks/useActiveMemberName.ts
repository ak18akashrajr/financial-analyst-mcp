import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { ALL_FAMILY_DISPLAY_NAME, getMemberDisplayName } from '@/lib/familyMemberDisplay';

/** The display name for whoever's portfolio is currently active — the selected family member's
 * name, "Akash" for the seeded "Self" member, or "Fam" for the combined "All Family" view. Used
 * to personalize the greeting and other copy that names the portfolio's owner. */
export function useActiveMemberName(): string {
  const { activeMemberId } = useFamilyMemberSelection();
  const { members } = useFamilyMembers();

  if (activeMemberId === 'all') return ALL_FAMILY_DISPLAY_NAME;
  return getMemberDisplayName(members.find((m) => m.id === activeMemberId));
}
