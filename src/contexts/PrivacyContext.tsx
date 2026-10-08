import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getHidden, subscribe, toggleHidden } from '@/lib/privacyStore';

interface PrivacyContextType {
  hidden: boolean;
  toggle: () => void;
  mask: (value: string) => string;
}

/**
 * Kept so every page's existing `<PrivacyProvider>` wrapper still works, but it no longer holds any
 * state: the hidden flag now lives in the shared, session-persisted store (src/lib/privacyStore.ts),
 * so all pages see the same value and it survives a refresh.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePrivacy(): PrivacyContextType {
  const hidden = useSyncExternalStore(subscribe, getHidden, () => false);
  return useMemo(
    () => ({ hidden, toggle: toggleHidden, mask: (value: string) => (hidden ? '••••••' : value) }),
    [hidden],
  );
}
