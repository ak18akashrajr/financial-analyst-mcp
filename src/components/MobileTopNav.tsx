import { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  BarChart3,
  FileText,
  Crosshair,
  Target,
  Flag,
  Activity,
  Bot,
  FileSpreadsheet,
  LogOut,
  Landmark,
  DollarSign,
  TrendingUp,
  Terminal,
  Gauge,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';

const tabs = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/charts', label: 'Charts', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { to: '/benchmark', label: 'Benchmark', icon: TrendingUp },
  { to: '/dollar-adjusted-returns', label: 'USD View', icon: DollarSign },
  { to: '/taxes', label: 'Taxes', icon: FileText },
  { to: '/projections', label: 'Projections', icon: Crosshair },
  { to: '/deployment-plan', label: 'Deploy', icon: Target },
  { to: '/goal-track', label: 'Goals', icon: Flag },
  { to: '/rolling-returns', label: 'Rolling', icon: Activity },
  { to: '/risk-metrics', label: 'Risk Metrics', icon: Gauge },
  { to: '/ai', label: 'AI', icon: Bot },
  { to: '/dev-zone', label: 'Dev Zone', icon: Terminal },
];

export function MobileTopNav() {
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const activeTabRef = useRef<HTMLAnchorElement | null>(null);
  const logout = () => {
    signOut();
  };

  // 13 tabs never fit on a phone-width screen, so the strip always scrolls
  // horizontally — without this, navigating to a tab off the right edge (e.g.
  // "Dev Zone") left it scrolled out of view on return, with no cue that more
  // tabs existed past what was visible. Center the active tab on every route
  // change (including the first render) instead.
  useEffect(() => {
    // jsdom (unit tests) doesn't implement scrollIntoView at all — guard for it
    // rather than relying on every test environment providing a stub.
    activeTabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <header className="md:hidden sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <Link to="/overview" className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0">
            <Landmark className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[11px] font-semibold truncate">Blackcrest Capital Holdings</span>
            <span className="text-[9px] italic text-muted-foreground -mt-0.5 truncate">Preserving Capital. Building Legacy.</span>
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggle />
          <button
            onClick={logout}
            aria-label="Log out"
            className="flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="relative">
        <nav className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = t.to === '/overview' ? pathname === t.to : pathname.startsWith(t.to);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/overview'}
                ref={isActive ? activeTabRef : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 min-h-9 px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground active:bg-accent'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
        {/* Edge fades hint that the strip scrolls — with 13 tabs it always does,
            on every phone width. */}
        <div className="pointer-events-none absolute inset-y-0 bottom-2 left-0 w-4 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 bottom-2 right-0 w-4 bg-gradient-to-l from-background to-transparent" />
      </div>
    </header>
  );
}
