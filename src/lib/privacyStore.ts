// Shared "hide the numbers" state. It used to live in a PrivacyProvider that every page mounted for
// itself, so the toggle reset on every reload AND every page change (hide on Overview, open Charts and
// the figures were back). One module-level store, persisted in sessionStorage, fixes both:
//   - survives a refresh, and is shared by every page in the tab;
//   - dies with the tab, like the Supabase session (also in sessionStorage — see CLAUDE.md), and is
//     cleared explicitly on sign-out / when there is no session, so the next login starts visible.
// Only a boolean is stored, never any portfolio data.
const KEY = 'privacy_hidden';

let current: boolean | null = null; // lazily read from storage on first use
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked (private mode, etc.): fall back to in-memory only
  }
}

export function getHidden(): boolean {
  if (current === null) current = readStored();
  return current;
}

export function setHidden(next: boolean): void {
  current = next;
  try {
    if (next) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* in-memory value still applies for this page load */
  }
  listeners.forEach((l) => l());
}

export const toggleHidden = (): void => setHidden(!getHidden());

/** Back to the default (visible) and forget the stored choice — call when the session ends. */
export const resetHidden = (): void => setHidden(false);

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
