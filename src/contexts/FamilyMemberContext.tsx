import { createContext, useContext, useState, type ReactNode } from 'react';

// The active selection driving every portfolio query: a specific family member's id, or 'all' for
// the combined household view. Persisted to sessionStorage — same lifetime as the auth session
// (src/integrations/supabase/client.ts), so it survives a reload but not a closed tab.
const STORAGE_KEY = 'portfolio_active_family_member';

interface FamilyMemberContextType {
  activeMemberId: string | 'all';
  setActiveMemberId: (id: string | 'all') => void;
}

const FamilyMemberContext = createContext<FamilyMemberContextType>({
  activeMemberId: 'all',
  setActiveMemberId: () => {},
});

function readStored(): string | 'all' {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

export function FamilyMemberProvider({ children }: { children: ReactNode }) {
  const [activeMemberId, setActiveMemberIdState] = useState<string | 'all'>(readStored);

  const setActiveMemberId = (id: string | 'all') => {
    setActiveMemberIdState(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — selection just won't persist.
    }
  };

  return (
    <FamilyMemberContext.Provider value={{ activeMemberId, setActiveMemberId }}>
      {children}
    </FamilyMemberContext.Provider>
  );
}

export const useFamilyMemberSelection = () => useContext(FamilyMemberContext);
