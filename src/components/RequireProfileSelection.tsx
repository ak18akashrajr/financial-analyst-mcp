import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';

/**
 * Gates every route nested under it (see App.tsx) behind having confirmed a "Who's Watching"
 * profile at least once this tab session — same layout-route pattern as ProtectedRoute, but
 * sitting one level further in, inside it. `/select-profile` itself is mounted inside
 * ProtectedRoute but outside this gate, so picking a profile is never itself redirected back
 * here.
 */
export const RequireProfileSelection = () => {
  const { hasConfirmedProfile } = useFamilyMemberSelection();
  const location = useLocation();

  if (!hasConfirmedProfile) {
    const justLoggedIn = (location.state as { justLoggedIn?: boolean } | null)?.justLoggedIn;
    return <Navigate to="/select-profile" state={{ from: location, justLoggedIn }} replace />;
  }

  return <Outlet />;
};
