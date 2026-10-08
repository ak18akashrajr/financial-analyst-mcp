import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Landmark } from "lucide-react";
import { PublicBackdrop } from '@/components/PublicBackdrop';
import { useAuth } from '@/contexts/AuthContext';

const NotFound = () => {
  const location = useLocation();
  const { session } = useAuth();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <PublicBackdrop>
      <div className="w-full max-w-sm text-center space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">Blackcrest Capital Holdings</h1>
            <p className="text-xs text-muted-foreground italic mt-1">Preserving Capital. Building Legacy.</p>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-5xl font-bold tracking-tight text-foreground tabular-nums">404</p>
          <p className="text-sm text-muted-foreground">This page doesn't exist.</p>
        </div>
        <Link
          to={session ? '/overview' : '/'}
          className="inline-flex w-full items-center justify-center py-2.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {session ? 'Back to dashboard' : 'Return to Home'}
        </Link>
      </div>
    </PublicBackdrop>
  );
};

export default NotFound;
