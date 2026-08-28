import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Single, centralized auth gate applied as a layout route in App.tsx —
 * replaces the old pattern of each page individually wrapping itself in
 * <LoginGate>, which was inconsistently applied (Updates.tsx had no gate
 * at all). Every route nested under this one is gated the same way.
 *
 * A missing session redirects to the public /login route (rather than
 * inline-rendering the form) so the sidebar/nav — which now live under this
 * same gate, see App.tsx's AppLayout — never render alongside it, and so a
 * signed-out visit to any deep link gets a real /login URL. `state.from` is
 * threaded through so LoginForm can send the user back to where they meant
 * to go.
 */
export const ProtectedRoute = () => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;

  return <Outlet />;
};
