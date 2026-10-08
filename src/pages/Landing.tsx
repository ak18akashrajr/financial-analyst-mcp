import { Link, Navigate } from 'react-router-dom';
import { Bot, Calculator, Landmark, LineChart, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BrandedSplash } from '@/components/BrandedSplash';
import { PublicBackdrop } from '@/components/PublicBackdrop';

const FEATURES = [
  { label: 'Live holdings', Icon: TrendingUp },
  { label: 'Tax lots', Icon: Calculator },
  { label: 'Projections', Icon: LineChart },
  { label: 'AI analyst', Icon: Bot },
];

/**
 * Public entry point at "/". Signed-out visitors see a minimal splash with a
 * single Login CTA — no sidebar, no portfolio data, nothing gated. A visitor
 * who already has a session is sent straight to the dashboard; "/" never
 * shows the landing page and the dashboard at the same time.
 */
export default function Landing() {
  const { session, loading } = useAuth();

  if (loading) {
    return <BrandedSplash />;
  }

  if (session) return <Navigate to="/overview" replace />;

  return (
    <PublicBackdrop>
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center shadow-lg shadow-black/10">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">Blackcrest Capital Holdings</h1>
            <p className="text-xs text-muted-foreground italic mt-1">Preserving Capital. Building Legacy.</p>
          </div>
        </div>
        <ul
          aria-label="What's inside"
          className="flex flex-wrap justify-center gap-2 animate-in fade-in duration-500 delay-150 fill-mode-backwards"
        >
          {FEATURES.map(({ label, Icon }) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur"
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
        <Link
          to="/login"
          className="inline-flex w-full items-center justify-center py-2.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300 fill-mode-backwards"
        >
          Login
        </Link>
      </div>
    </PublicBackdrop>
  );
}
