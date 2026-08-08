import { Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/LoginForm';

/**
 * Single, centralized auth gate applied as a layout route in App.tsx —
 * replaces the old pattern of each page individually wrapping itself in
 * <LoginGate>, which was inconsistently applied (Updates.tsx had no gate
 * at all). Every route nested under this one is gated the same way.
 */
export const ProtectedRoute = () => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session) return <LoginForm />;

  return <Outlet />;
};
