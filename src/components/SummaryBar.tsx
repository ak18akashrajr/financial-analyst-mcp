import type { PortfolioSummary, Transaction } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { TrendingUp, TrendingDown, ArrowUpRight, Wallet, Vault, CreditCard, Landmark } from 'lucide-react';
import { XirrDetailsCard } from '@/components/XirrDetailsCard';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  summary: PortfolioSummary;
  transactions: Transaction[];
}

export function SummaryBar({ summary, transactions }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const pnlPositive = summary.totalPnl >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Hero — Net Worth (col-span-5, like the "balance" card) */}
      <div className="relative lg:col-span-5 rounded-2xl border border-border bg-card p-6 flex flex-col justify-between min-h-[180px] overflow-hidden">
        <AumBackdrop positive={pnlPositive} />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Assets Under Management (AUM)</p>
            <p className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
              {fmt(summary.totalPortfolioValue)}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold ${
              pnlPositive ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
            }`}
          >
            {pnlPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pnlPositive ? '+' : ''}{summary.totalPnlPercent.toFixed(2)}%
          </span>
        </div>
        <div className="relative flex items-center justify-between text-xs text-muted-foreground border-t border-border/70 pt-3 mt-4">
          <span>Holdings + Cash − Debt</span>
          <span className="font-mono">
            Principal Capital Allocated {fmt(summary.investedValue)} · Current {fmt(summary.currentValue)}
          </span>
        </div>
      </div>

      {/* P&L */}
      <StatCard
        icon={<ArrowUpRight className="w-4 h-4" />}
        accent="bg-gain/10 text-gain"
        label="Realized & Unrealized Alpha"
        value={fmt(summary.totalPnl)}
        sub={`${pnlPositive ? '+' : ''}${summary.totalPnlPercent.toFixed(2)}% all-time`}
        valueClass={pnlPositive ? 'text-gain' : 'text-loss'}
      />

      {/* XIRR — click for Overall / ex-PF / benchmark breakdown */}
      <XirrDetailsCard overallXirr={summary.xirr} portfolioXirr={summary.xirrExPf} transactions={transactions} />

      {/* Cash row */}
      <div className="lg:col-span-12 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <MiniStat icon={<Wallet className="w-3.5 h-3.5" />} label="Operating Cash" value={fmt(summary.liquidCash)} />
        <MiniStat icon={<Vault className="w-3.5 h-3.5" />} label="Cash Reserve" value={fmt(summary.vaultCash)} />
        <MiniStat icon={<Landmark className="w-3.5 h-3.5" />} label="PF (PPF/EPF)" value={fmt(summary.pfBalance)} />
        <MiniStat
          icon={<CreditCard className="w-3.5 h-3.5" />}
          label="Outstanding Liabilities"
          value={summary.creditCardDebt > 0 ? `−${fmt(summary.creditCardDebt)}` : fmt(0)}
          tone={summary.creditCardDebt > 0 ? 'loss' : 'default'}
        />
        <MiniStat
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Principal Capital Allocated"
          value={fmt(summary.investedValue)}
        />
      </div>
    </div>
  );
}

// Decorative area-chart pattern echoing the AUM trend, tucked behind the hero
// card's text (bottom-right, low-opacity). Not driven by real historical
// data — a single smooth ascending sweep, flat/invisible through the left
// half of the card and rising into the bottom-right corner, in the spirit of
// the dotted "Holdings · Cash · Principal · ..." legend line above it.
function AumBackdrop({ positive }: { positive: boolean }) {
  const color = positive ? 'hsl(var(--gain))' : 'hsl(var(--loss))';
  const fillGradientId = positive ? 'aumBackdropGainFill' : 'aumBackdropLossFill';
  const lineGradientId = positive ? 'aumBackdropGainLine' : 'aumBackdropLossLine';
  const linePath = 'M0,95 C40,94 70,93 90,90 C110,87 122,81 140,74 C165,64 185,49 210,34 C235,19 260,9 300,3';
  return (
    <svg
      className="absolute inset-x-0 bottom-0 w-full h-28 sm:h-32 pointer-events-none"
      viewBox="0 0 300 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {/* Diagonal fade: near-invisible at bottom-left, solid by the top-right */}
        <linearGradient id={fillGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.02" />
          <stop offset="55%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id={lineGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.1" />
          <stop offset="55%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <path d={`${linePath} L300,100 L0,100 Z`} fill={`url(#${fillGradientId})`} />
      <path d={linePath} fill="none" stroke={`url(#${lineGradientId})`} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({
  icon,
  accent,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="lg:col-span-3 rounded-2xl border border-border bg-card p-5 flex flex-col justify-between min-h-[180px]">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${valueClass || 'text-foreground'}`}>
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'loss';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-secondary text-foreground flex items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
        <p
          className={`text-sm font-semibold tracking-tight truncate ${
            tone === 'loss' ? 'text-loss' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
