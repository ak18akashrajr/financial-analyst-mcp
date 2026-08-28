import { Navigate } from 'react-router-dom';
import { LoginForm } from '@/components/LoginForm';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Public "/login" route. If a session already exists (e.g. a signed-in user
 * navigates here directly, or a stale tab), skip straight to the dashboard
 * instead of showing the form again. Redirect-after-success is handled
 * inside LoginForm itself, since it already owns the signIn() call.
 */
export default function Login() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (session) return <Navigate to="/overview" replace />;

  return <LoginForm />;
}
