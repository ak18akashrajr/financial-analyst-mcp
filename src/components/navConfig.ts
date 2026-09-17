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
  DollarSign,
  TrendingUp,
  Terminal,
  Gauge,
  LineChart,
  Users2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// Shared between SideNav (desktop) and MobileTopNav (hamburger drawer) so the
// two surfaces can never drift apart on which routes exist or how they're
// grouped.
export const navGroups: NavGroup[] = [
  {
    label: null, // ungrouped — always visible, no section header
    items: [{ to: '/overview', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/charts', label: 'Charts', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
      { to: '/benchmark', label: 'Benchmark', icon: TrendingUp },
      { to: '/dollar-adjusted-returns', label: 'USD View', icon: DollarSign },
      { to: '/rolling-returns', label: 'Rolling', icon: Activity },
      { to: '/risk-metrics', label: 'Risk Metrics', icon: Gauge },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/taxes', label: 'Taxes', icon: FileText },
      { to: '/projections', label: 'Projections', icon: Crosshair },
      { to: '/forecast', label: 'Forecast', icon: LineChart },
      { to: '/deployment-plan', label: 'Deploy', icon: Target },
      { to: '/goal-track', label: 'Goals', icon: Flag },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/ai', label: 'AI', icon: Bot },
      { to: '/family-members', label: 'Family', icon: Users2 },
      { to: '/dev-zone', label: 'Dev Zone', icon: Terminal },
    ],
  },
];
