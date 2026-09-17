import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { getMemberDisplayName, SELF_DISPLAY_NAME } from '@/lib/familyMemberDisplay';

/** The display name for whoever's portfolio is currently active — the selected family member's
 * name, "Akash" for the seeded "Self" member, or the combined "All Family" view (also "Akash",
 * since that's the household owner's own dashboard). Used to personalize the greeting and other
 * copy that names the portfolio's owner. */
export function useActiveMemberName(): string {
  const { activeMemberId } = useFamilyMemberSelection();
  const { members } = useFamilyMembers();

  if (activeMemberId === 'all') return SELF_DISPLAY_NAME;
  return getMemberDisplayName(members.find((m) => m.id === activeMemberId));
}
