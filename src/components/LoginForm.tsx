import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Landmark } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { LoginLoadingScreen } from '@/components/LoginLoadingScreen';

// Swagger lines shown in place of Supabase's generic "Invalid login
// credentials" — scoped to *that specific* error (see isBadCredentialsError
// below) so a real problem (network down, rate-limited, etc.) still surfaces
// its plain, actionable message instead of a joke. Exported so the test
// suite can assert against a known line rather than a random one.
export const SWAG_LOGIN_ERRORS = [
  'Nice try — the vault didn’t blink. 🔒',
  'Wrong move, chief. The ledger doesn’t lie.',
  'That’s not it. Even your portfolio winced.',
  'Big swing, bigger miss. Try again.',
  'Access denied — the algorithm’s unimpressed.',
  'Nope. Diversify your guesses next time.',
  'That password’s underperforming. Try again.',
  'The vault stays shut on that one.',
];

const pickSwagLoginError = () =>
  SWAG_LOGIN_ERRORS[Math.floor(Math.random() * SWAG_LOGIN_ERRORS.length)];

// Only the exact "wrong email/password" case gets the playful treatment —
// everything else (network failure, rate limiting, server errors) is a real
// problem and should read like one.
const isBadCredentialsError = (message: string) => /invalid login credentials/i.test(message);

export const LoginForm = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  // True for the brief window between a successful sign-in and handing off
  // to LoginLoadingScreen — lets the form fade/shrink out instead of being
  // swapped for the loading screen on a hard cut.
  const [leaving, setLeaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(isBadCredentialsError(signInError) ? pickSwagLoginError() : signInError);
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
    // Credentials are good — play a brief fade-out on the form itself, then
    // hand off to the loading screen, which navigates on to the dashboard
    // once its own cosmetic sequence finishes.
    setLeaving(true);
    setTimeout(() => setAuthenticated(true), 200);
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
        className={`w-full max-w-sm space-y-5 p-8 rounded-xl border border-border bg-card shadow-sm transition-opacity ${
          leaving ? 'animate-out fade-out zoom-out-95 duration-200' : 'animate-in fade-in zoom-in-95 duration-500'
        }`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center">
            <Landmark className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-foreground tracking-tight">Blackcrest Capital Holdings</h1>
            <p className="text-xs text-muted-foreground">Sign in to continue</p>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground">Email</label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            className="transition-all duration-300 ease-out"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="login-password" className="text-xs font-medium text-muted-foreground">Password</label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            className="transition-all duration-300 ease-out"
          />
        </div>
        {error && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-destructive text-center font-medium">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-[opacity,transform] duration-200"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
