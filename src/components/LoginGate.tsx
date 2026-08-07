import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface LoginGateProps {
  children: React.ReactNode;
}

export const LoginGate = ({ children }: LoginGateProps) => {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem('portfolio_auth') === 'true'
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === 'ak18' && password === '2003') {
      sessionStorage.setItem('portfolio_auth', 'true');
      setAuthenticated(true);
    } else {
      setError('Invalid credentials');
    }
  };

  if (authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-5 p-8 rounded-xl border border-border bg-card shadow-lg">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground tracking-tight">🔒 Portfolio Engine</h1>
          <p className="text-xs text-muted-foreground italic">Prove you belong here.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Who are you?</label>
          <Input
            placeholder="Enter your identity..."
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Say the magic word</label>
          <Input
            type="password"
            placeholder="Whisper it here..."
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
          />
        </div>
        {error && <p className="text-xs text-destructive text-center font-medium">🚫 Nope, try again.</p>}
        <button
          type="submit"
          className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Login
        </button>
      </form>
    </div>
  );
};
