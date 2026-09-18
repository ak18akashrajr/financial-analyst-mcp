import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';

/** The `relationship` of whoever's portfolio is currently active — null for the combined "All
 * Family" view or when the selected member can't be resolved. Used to gate UI (e.g. hiding Dev
 * Zone from the nav for a "Parent"-tagged member) by who's actually looking, not just by which
 * account is signed in. */
export function useActiveMemberRelationship(): string | null {
  const { activeMemberId } = useFamilyMemberSelection();
  const { members } = useFamilyMembers();

  if (activeMemberId === 'all') return null;
  return members.find((m) => m.id === activeMemberId)?.relationship ?? null;
}
