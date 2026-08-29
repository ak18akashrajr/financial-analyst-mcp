import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SideNav } from '@/components/SideNav';
import { MobileTopNav } from '@/components/MobileTopNav';
import { SecurityIncidentBanner } from '@/components/SecurityIncidentBanner';
import { SecurityIncidentsProvider } from '@/contexts/SecurityIncidentsContext';

/**
 * Chrome for the authenticated app only. Nested inside <ProtectedRoute> in
 * App.tsx so the sidebar/mobile nav can never render for a signed-out
 * visitor — previously SideNav/MobileTopNav were mounted at the top of the
 * whole app, so they showed even on the login screen.
 *
 * SecurityIncidentsProvider lives here (not wrapping the whole app) for the
 * same reason: it only needs to run for an authenticated session, and
 * AppLayout persists across every protected-page navigation, so the
 * incident check genuinely happens once per session, not once per page.
 */
export function AppLayout() {
  const location = useLocation();
  // LoginForm's goToDashboard navigates here with `state.justLoggedIn` right
  // as LoginLoadingScreen fades out, so the very first protected page reads
  // as a continuous crossfade rather than an abrupt cut. Captured once via
  // the lazy initializer — AppLayout mounts a single time per authenticated
  // session (react-router keeps a parent route element mounted across its
  // nested Outlet's own route changes), so later in-app navigation never
  // re-triggers this entrance even though `location` keeps changing.
  const [enteringFromLogin] = useState(() => !!(location.state as { justLoggedIn?: boolean } | null)?.justLoggedIn);

  return (
    <SecurityIncidentsProvider>
      <SecurityIncidentBanner />
      <SideNav />
      <MobileTopNav />
      <div
        data-testid="app-content"
        className={`md:pl-[calc(var(--sidenav-w,16rem)+1.25rem)] transition-[padding] duration-300 ease-out ${
          enteringFromLogin ? 'animate-in fade-in slide-in-from-bottom-2 duration-500' : ''
        }`}
      >
        <Outlet />
      </div>
    </SecurityIncidentsProvider>
  );
}
