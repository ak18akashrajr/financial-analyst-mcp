// The hide-numbers choice lasts until the session ends: explicit sign-out, a forced sign-out
// (expired/revoked token, which arrives as a null session on onAuthStateChange), or a page load that
// finds no session at all.
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { getHidden, setHidden } from '@/lib/privacyStore';

const h = vi.hoisted(() => ({
  authCallback: undefined as undefined | ((event: string, session: unknown) => void),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => h.getSession(),
      signOut: () => h.signOut(),
      signInWithPassword: vi.fn(),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

let auth: ReturnType<typeof useAuth>;
function Grab() {
  auth = useAuth();
  return null;
}
const mount = () => render(<AuthProvider><Grab /></AuthProvider>);

describe('privacy toggle vs. session lifetime', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
    h.signOut.mockResolvedValue({ error: null });
  });

  it('keeps the hidden choice while a session exists (a refresh with a valid session)', async () => {
    setHidden(true);
    mount();
    await waitFor(() => expect(auth.loading).toBe(false));
    expect(getHidden()).toBe(true);
  });

  it('clears it on explicit sign-out', async () => {
    mount();
    await waitFor(() => expect(auth.loading).toBe(false));
    setHidden(true);
    await act(async () => auth.signOut());
    expect(getHidden()).toBe(false);
  });

  it('clears it on a forced sign-out (null session from onAuthStateChange)', async () => {
    mount();
    await waitFor(() => expect(auth.loading).toBe(false));
    setHidden(true);
    act(() => h.authCallback?.('SIGNED_OUT', null));
    expect(getHidden()).toBe(false);
  });

  it('does not clear it on a token refresh that still has a session', async () => {
    mount();
    await waitFor(() => expect(auth.loading).toBe(false));
    setHidden(true);
    act(() => h.authCallback?.('TOKEN_REFRESHED', { access_token: 'new' }));
    expect(getHidden()).toBe(true);
  });

  it('clears a stale choice when the page loads with no session', async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    setHidden(true);
    mount();
    await waitFor(() => expect(auth.loading).toBe(false));
    expect(getHidden()).toBe(false);
  });
});
