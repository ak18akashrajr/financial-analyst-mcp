import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

export const LoginForm = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const { error: signInError } = await signIn(email, password);
    if (signInError) setError(signInError);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-5 p-8 rounded-xl border border-border bg-card shadow-lg">
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
          className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitting ? 'Signing in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};
