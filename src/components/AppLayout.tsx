import { Outlet } from 'react-router-dom';
import { SideNav } from '@/components/SideNav';
import { MobileTopNav } from '@/components/MobileTopNav';

/**
 * Chrome for the authenticated app only. Nested inside <ProtectedRoute> in
 * App.tsx so the sidebar/mobile nav can never render for a signed-out
 * visitor — previously SideNav/MobileTopNav were mounted at the top of the
 * whole app, so they showed even on the login screen.
 */
export function AppLayout() {
  return (
    <>
      <SideNav />
      <MobileTopNav />
      <div className="md:pl-[calc(var(--sidenav-w,16rem)+1.25rem)] transition-[padding] duration-300 ease-out">
        <Outlet />
      </div>
    </>
  );
}
