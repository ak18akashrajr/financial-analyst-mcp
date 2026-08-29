import { Outlet } from 'react-router-dom';
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
  return (
    <SecurityIncidentsProvider>
      <SecurityIncidentBanner />
      <SideNav />
      <MobileTopNav />
      <div className="md:pl-[calc(var(--sidenav-w,16rem)+1.25rem)] transition-[padding] duration-300 ease-out">
        <Outlet />
      </div>
    </SecurityIncidentsProvider>
  );
}
