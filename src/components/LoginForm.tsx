import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { LoginLoadingScreen } from '@/components/LoginLoadingScreen';

export const LoginForm = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(signInError);
      setSubmitting(false);
      // Replay the shake by force-reflowing the class rather than keying a
      // remount, so a wrong password doesn't blur the input or clear what
      // was typed — the reflow makes the *same* class re-trigger even when
      // two failed attempts in a row produce the exact same error string.
      const el = formRef.current;
      if (el) {
        el.classList.remove('animate-shake');
        void el.offsetWidth;
        el.classList.add('animate-shake');
      }
      return;
    }
    // Credentials are good — hand off to the loading screen, which
    // navigates on to the dashboard once its cosmetic sequence finishes.
    setAuthenticated(true);
  };

  const goToDashboard = () => {
    // Send the user back to whatever protected page they were trying to
    // reach before ProtectedRoute bounced them to /login (see
    // ProtectedRoute.tsx's `state={{ from: location }}`), defaulting to the
    // dashboard for a direct visit to /login. `justLoggedIn` lets AppLayout
    // play a one-off entrance animation for the page it lands on, without
    // replaying on every normal in-app navigation afterward.
    const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/overview';
    navigate(from, { replace: true, state: { justLoggedIn: true } });
  };

  if (authenticated) {
    return <LoginLoadingScreen onDone={goToDashboard} />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form
        ref={formRef}
        onSubmit={handleLogin}
        className="w-full max-w-sm space-y-5 p-8 rounded-xl border border-border bg-card shadow-lg animate-in fade-in zoom-in-95 duration-500"
      >
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground tracking-tight">🔒 Portfolio Engine</h1>
          <p className="text-xs text-muted-foreground italic">Prove you belong here.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Password</label>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
          />
        </div>
        {error && <p className="text-xs text-destructive text-center font-medium">🚫 {error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-[opacity,transform]"
        >
          {submitting ? 'Signing in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};
