import { useLocation, useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { getMemberAvatar } from '@/lib/familyMemberAvatar';
import { ALL_FAMILY_DISPLAY_NAME, getMemberDisplayName } from '@/lib/familyMemberDisplay';

/**
 * Small avatar button that reopens the "Who's Watching" picker (src/pages/WhosWatching.tsx)
 * without signing out — the switch-profile entry point. Sits alongside the existing
 * FamilyMemberSwitcher dropdown in SideNav/MobileTopNav; that dropdown is unaffected and keeps
 * switching activeMemberId directly, this button only navigates to /select-profile.
 */
export function ActiveProfileButton({ collapsed }: { collapsed?: boolean }) {
  const { activeMemberId } = useFamilyMemberSelection();
  const { members, loading } = useFamilyMembers();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading || members.length === 0) return null;

  const activeMember = members.find((m) => m.id === activeMemberId) ?? null;
  const label = activeMemberId === 'all' ? ALL_FAMILY_DISPLAY_NAME : getMemberDisplayName(activeMember);
  const avatar = activeMember ? getMemberAvatar(activeMember.name) : null;

  const switchProfile = () => navigate('/select-profile', { state: { from: location } });

  return (
    <button
      onClick={switchProfile}
      title={`Switch profile (currently ${label})`}
      aria-label="Switch profile"
      className={`flex items-center justify-center rounded-lg font-semibold text-xs shrink-0 hover:ring-2 hover:ring-foreground/40 transition-all ${
        collapsed ? 'w-9 h-9 mx-auto' : 'w-8 h-8'
      } ${avatar ? avatar.colorClass : 'bg-muted text-muted-foreground'}`}
    >
      {avatar ? avatar.initials : <Users className="w-4 h-4" />}
    </button>
  );
}
