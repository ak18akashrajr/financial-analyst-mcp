import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SideNav } from '@/components/SideNav';
import { MobileTopNav } from '@/components/MobileTopNav';
import { SecurityIncidentBanner } from '@/components/SecurityIncidentBanner';
import { SecurityIncidentsProvider } from '@/contexts/SecurityIncidentsContext';
import { PortfolioAIChatProvider } from '@/contexts/PortfolioAIChatContext';
import { PageSkeleton } from '@/components/PageSkeleton';

/**
 * Chrome for the authenticated app only. Nested inside <ProtectedRoute> in
 * App.tsx so the sidebar/mobile nav can never render for a signed-out
 * visitor — previously SideNav/MobileTopNav were mounted at the top of the
 * whole app, so they showed even on the login screen.
 *
 * SecurityIncidentsProvider and PortfolioAIChatProvider both live here (not
 * wrapping the whole app) for the same reason: they only need to run for an
 * authenticated session, and AppLayout persists across every protected-page
 * navigation, so the incident check genuinely happens once per session (not
 * once per page), and the /ai chat's message history survives navigating to
 * another page and back — previously that state lived in PortfolioAI
 * itself, which unmounts on every route change like any other page, so
 * leaving /ai and coming back reset the whole conversation. Since
 * ProtectedRoute stops rendering AppLayout the moment the session goes
 * away, the chat is also cleared for free on logout, with no separate
 * sign-out handling needed.
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
      <PortfolioAIChatProvider>
        <SecurityIncidentBanner />
        <SideNav />
        <MobileTopNav />
        <div
          data-testid="app-content"
          className={`md:pl-[calc(var(--sidenav-w,16rem)+1.25rem)] transition-[padding] duration-300 ease-out ${
            enteringFromLogin ? 'animate-in fade-in slide-in-from-bottom-2 duration-500' : ''
          }`}
        >
          {/* Keyed on pathname so each page change replays a short fade/rise — previously only the
              post-login entrance animated and navigation swapped content abruptly. Query-string
              changes (e.g. /dev-zone?tab=) keep the same pathname, so tabs don't re-animate. */}
          <div key={location.pathname} data-testid="page-transition" className="animate-in fade-in slide-in-from-bottom-1 duration-300">
            {/* A lazy page chunk suspends here, inside the layout, so the sidebar stays put and the
                content area shows a page-shaped skeleton — rather than suspending up to App.tsx's
                top-level boundary and replacing the whole screen (nav included) with the splash. */}
            <Suspense
              fallback={
                <div className="min-h-screen bg-background">
                  <div className="max-w-6xl mx-auto px-4 py-5">
                    <PageSkeleton showHeader />
                  </div>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </div>
      </PortfolioAIChatProvider>
    </SecurityIncidentsProvider>
  );
}
