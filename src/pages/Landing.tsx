import { Link, Navigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Public entry point at "/". Signed-out visitors see a minimal splash with a
 * single Login CTA — no sidebar, no portfolio data, nothing gated. A visitor
 * who already has a session is sent straight to the dashboard; "/" never
 * shows the landing page and the dashboard at the same time.
 */
export default function Landing() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (session) return <Navigate to="/overview" replace />;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">Blackcrest Capital Holdings</h1>
            <p className="text-xs text-muted-foreground italic mt-1">Preserving Capital. Building Legacy.</p>
          </div>
        </div>
        <Link
          to="/login"
          className="inline-flex w-full items-center justify-center py-2.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Login
        </Link>
      </div>
    </div>
  );
}
