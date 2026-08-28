import { Link, NavLink } from 'react-router-dom';
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
  { to: '/ai', label: 'AI', icon: Bot },
  { to: '/dev-zone', label: 'Dev Zone', icon: Terminal },
];

export function MobileTopNav() {
  const { signOut } = useAuth();
  const logout = () => {
    signOut();
  };
  return (
    <header className="md:hidden sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between px-4 py-2.5">
        <Link to="/overview" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center">
            <Landmark className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-semibold">Blackcrest Capital Holdings</span>
            <span className="text-[9px] italic text-muted-foreground -mt-0.5">Preserving Capital. Building Legacy.</span>
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button onClick={logout} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <nav className="flex items-center gap-1 px-3 pb-2 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/overview'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}
