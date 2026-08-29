import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LoginForm } from '@/components/LoginForm';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Public "/login" route. If a session already exists (e.g. a signed-in user
 * navigates here directly, or a stale tab), skip straight to the dashboard
 * instead of showing the form again. Redirect-after-success is handled
 * inside LoginForm itself, since it already owns the signIn() call.
 *
 * The "already has a session" check is captured ONCE, right after the
 * initial auth check resolves, and never re-evaluated after that. `session`
 * is read reactively from AuthContext, and supabase.auth.onAuthStateChange
 * flips it to non-null within a tick of a fresh signIn() succeeding inside
 * LoginForm — if this component kept reacting to `session` on every render,
 * that flip would redirect away immediately and unmount LoginForm (and the
 * post-login loading animation it's mid-way through showing) before either
 * ever got a chance to render. See LoginLoadingScreen.tsx.
 */
export default function Login() {
  const { session, loading } = useAuth();
  const [initialSessionCheck, setInitialSessionCheck] = useState<{ hadSession: boolean } | null>(null);

  useEffect(() => {
    if (!loading && !initialSessionCheck) {
      setInitialSessionCheck({ hadSession: !!session });
    }
  }, [loading, session, initialSessionCheck]);

  if (loading || !initialSessionCheck) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (initialSessionCheck.hadSession) return <Navigate to="/overview" replace />;

  return <LoginForm />;
}
