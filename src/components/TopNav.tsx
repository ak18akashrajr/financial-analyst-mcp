import { Link, NavLink, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
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
} from 'lucide-react';

const tabs = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/charts', label: 'Charts', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { to: '/taxes', label: 'Taxes', icon: FileText },
  { to: '/projections', label: 'Projections', icon: Crosshair },
  { to: '/deployment-plan', label: 'Deploy', icon: Target },
  { to: '/goal-track', label: 'Goals', icon: Flag },
  { to: '/rolling-returns', label: 'Rolling', icon: Activity },
  { to: '/ai', label: 'AI', icon: Bot },
];

interface Props {
  actions?: ReactNode;
}

export function TopNav({ actions }: Props) {
  const { pathname } = useLocation();
  return (
    <header className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center font-bold text-sm">
            ₹
          </div>
          <Link to="/" className="text-base font-semibold tracking-tight text-foreground">
            Portfolio Engine
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 ml-2 rounded-full border border-border bg-secondary text-[11px] font-medium text-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
            Personal
          </span>
        </div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <nav className="flex items-center gap-1 px-3 py-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {active && (
                <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-foreground" />
              )}
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}
