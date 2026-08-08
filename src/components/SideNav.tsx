import { useEffect, useState } from 'react';
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
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';

const tabs = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/charts', label: 'Charts', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { to: '/dollar-adjusted-returns', label: 'USD View', icon: DollarSign },
  { to: '/taxes', label: 'Taxes', icon: FileText },
  { to: '/projections', label: 'Projections', icon: Crosshair },
  { to: '/deployment-plan', label: 'Deploy', icon: Target },
  { to: '/goal-track', label: 'Goals', icon: Flag },
  { to: '/rolling-returns', label: 'Rolling', icon: Activity },
  { to: '/ai', label: 'AI', icon: Bot },
];

const EXPANDED = '16rem';
const COLLAPSED = '5rem';

export function SideNav() {
  const { signOut } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidenav_collapsed') === '1';
  });

  useEffect(() => {
    localStorage.setItem('sidenav_collapsed', collapsed ? '1' : '0');
    document.documentElement.style.setProperty('--sidenav-w', collapsed ? COLLAPSED : EXPANDED);
  }, [collapsed]);

  const logout = () => {
    signOut();
  };

  return (
    <aside
      className={`hidden md:flex fixed top-3 bottom-3 left-3 z-40 flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-black/5 transition-[width] duration-300 ease-out overflow-hidden ${
        collapsed ? 'w-[4.25rem] p-2' : 'w-[15.25rem] p-3'
      }`}
    >
      {/* Brand + collapse */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 mb-4 px-1`}>
        {!collapsed ? (
          <Link to="/" className="flex items-start gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
              <Landmark className="w-4.5 h-4.5" />
            </div>
            <div className="flex flex-col leading-tight pt-0.5 min-w-0">
              <span className="text-[12.5px] font-semibold tracking-tight truncate">Blackcrest Capital</span>
              <span className="text-[12.5px] font-semibold tracking-tight truncate -mt-0.5">Holdings</span>
              <span className="text-[9.5px] italic text-muted-foreground mt-1 leading-snug">
                Preserving Capital.<br />Building Legacy.
              </span>
            </div>
          </Link>
        ) : (
          <Link to="/" className="w-9 h-9 rounded-lg bg-foreground text-background flex items-center justify-center">
            <Landmark className="w-4.5 h-4.5" />
          </Link>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={`flex items-center gap-2 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/70 hover:bg-accent transition-colors mb-3 ${
          collapsed ? 'justify-center h-8 w-full' : 'px-2.5 py-1.5'
        }`}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? <ChevronsRight className="w-3.5 h-3.5" /> : (
          <>
            <ChevronsLeft className="w-3.5 h-3.5" />
            <span>Collapse</span>
          </>
        )}
      </button>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              title={collapsed ? t.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg text-[13px] font-medium transition-colors ${
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="truncate">{t.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`mt-3 pt-3 border-t border-border flex ${collapsed ? 'flex-col items-center gap-2' : 'items-center gap-2'}`}>
        <ThemeToggle />
        <button
          onClick={logout}
          className={`flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition ${
            collapsed ? 'w-9 h-9' : 'ml-auto w-8 h-8'
          }`}
          title="Logout"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
