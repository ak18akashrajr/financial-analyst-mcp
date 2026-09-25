import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Landmark } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

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
        <div className="space-y-1">
          <p className="text-3xl font-bold text-foreground">404</p>
          <p className="text-sm text-muted-foreground">This page doesn't exist.</p>
        </div>
        <Link
          to="/"
          className="inline-flex w-full items-center justify-center py-2.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
