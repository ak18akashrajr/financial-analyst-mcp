import { useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { getMemberAvatar } from '@/lib/familyMemberAvatar';
import { ALL_FAMILY_DISPLAY_NAME, getMemberDisplayName } from '@/lib/familyMemberDisplay';
import { ProfileEnterLoadingScreen } from '@/components/ProfileEnterLoadingScreen';

interface NavState {
  from?: Location;
  justLoggedIn?: boolean;
}

interface PickedProfile {
  id: string | 'all';
  name: string;
}

/**
 * Netflix/Notion-style "Who's Watching" picker, shown once per tab session right after auth —
 * see RequireProfileSelection, which redirects here until confirmProfile() has been called.
 * Reuses the same family_members data and activeMemberId selection as the in-app
 * FamilyMemberSwitcher dropdown; this page only adds the one-time full-screen prompt and the
 * confirmation flag, it doesn't change what a selection means anywhere else in the app.
 */
export default function WhosWatching() {
  const { members, loading } = useFamilyMembers();
  const { confirmProfile } = useFamilyMemberSelection();
  const navigate = useNavigate();
  const location = useLocation();
  const [picked, setPicked] = useState<PickedProfile | null>(null);

  const pick = (id: string | 'all', name: string) => setPicked({ id, name });

  const enterApp = () => {
    if (!picked) return;
    confirmProfile?.(picked.id);
    const state = location.state as NavState | null;
    const destination = state?.from?.pathname ?? '/overview';
    navigate(destination, { replace: true, state: { justLoggedIn: state?.justLoggedIn } });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (picked) {
    return <ProfileEnterLoadingScreen name={picked.name} onDone={enterApp} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Who's watching?</h1>
      <p className="text-sm text-muted-foreground mb-10">Pick a profile to continue</p>

      <div className="flex flex-wrap items-start justify-center gap-6 max-w-2xl">
        <button
          onClick={() => pick('all', ALL_FAMILY_DISPLAY_NAME)}
          className="group flex flex-col items-center gap-2.5 w-28"
        >
          <span className="flex items-center justify-center w-20 h-20 rounded-2xl bg-muted text-muted-foreground group-hover:ring-2 group-hover:ring-foreground/60 transition-all">
            <Users className="w-8 h-8" />
          </span>
          <span className="text-sm font-medium text-center truncate w-full">{ALL_FAMILY_DISPLAY_NAME}</span>
        </button>

        {members.map((m) => {
          const { initials, colorClass } = getMemberAvatar(m.name);
          return (
            <button
              key={m.id}
              onClick={() => pick(m.id, getMemberDisplayName(m))}
              className="group flex flex-col items-center gap-2.5 w-28"
            >
              <span
                className={`flex items-center justify-center w-20 h-20 rounded-2xl text-2xl font-semibold group-hover:ring-2 group-hover:ring-foreground/60 transition-all ${colorClass}`}
              >
                {initials}
              </span>
              <span className="text-sm font-medium text-center truncate w-full">
                {getMemberDisplayName(m)}
              </span>
              <span className="text-xs text-muted-foreground -mt-1.5 truncate w-full text-center">
                {m.relationship}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
