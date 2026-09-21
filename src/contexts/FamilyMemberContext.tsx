import { createContext, useContext, useState, type ReactNode } from 'react';

// The active selection driving every portfolio query: a specific family member's id, or 'all' for
// the combined household view. Persisted to sessionStorage — same lifetime as the auth session
// (src/integrations/supabase/client.ts), so it survives a reload but not a closed tab.
const STORAGE_KEY = 'portfolio_active_family_member';

// Separate from STORAGE_KEY so the many existing activeMemberId consumers (usePortfolio,
// useActiveMemberRelationship, FamilyMemberSwitcher, ...) are unaffected — this only gates the
// "Who's Watching" picker (RequireProfileSelection), tracking whether the picker has been
// confirmed at least once this tab session.
const CONFIRMED_KEY = 'portfolio_profile_confirmed';

interface FamilyMemberContextType {
  activeMemberId: string | 'all';
  setActiveMemberId: (id: string | 'all') => void;
  // Optional so the existing test suites that mock this context with a plain
  // { activeMemberId, setActiveMemberId } literal keep compiling unchanged.
  hasConfirmedProfile?: boolean;
  confirmProfile?: (id: string | 'all') => void;
}

const FamilyMemberContext = createContext<FamilyMemberContextType>({
  activeMemberId: 'all',
  setActiveMemberId: () => {},
  hasConfirmedProfile: false,
  confirmProfile: () => {},
});

function readStored(): string | 'all' {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function readConfirmed(): boolean {
  try {
    return sessionStorage.getItem(CONFIRMED_KEY) === '1';
  } catch {
    return false;
  }
}

export function FamilyMemberProvider({ children }: { children: ReactNode }) {
  const [activeMemberId, setActiveMemberIdState] = useState<string | 'all'>(readStored);
  const [hasConfirmedProfile, setHasConfirmedProfile] = useState<boolean>(readConfirmed);

  const setActiveMemberId = (id: string | 'all') => {
    setActiveMemberIdState(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — selection just won't persist.
    }
  };

  // Used by the "Who's Watching" picker only — wraps setActiveMemberId with the one-time-per-
  // session confirmation flag RequireProfileSelection checks. The in-app dropdown switcher
  // (FamilyMemberSwitcher) intentionally keeps calling plain setActiveMemberId so switching there
  // never touches confirmation.
  const confirmProfile = (id: string | 'all') => {
    setActiveMemberId(id);
    setHasConfirmedProfile(true);
    try {
      sessionStorage.setItem(CONFIRMED_KEY, '1');
    } catch {
      // sessionStorage unavailable — the picker will just show again next navigation.
    }
  };

  return (
    <FamilyMemberContext.Provider
      value={{ activeMemberId, setActiveMemberId, hasConfirmedProfile, confirmProfile }}
    >
      {children}
    </FamilyMemberContext.Provider>
  );
}

export const useFamilyMemberSelection = () => useContext(FamilyMemberContext);
