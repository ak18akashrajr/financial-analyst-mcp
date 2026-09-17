import { useState } from 'react';
import type { CashSettings, PortfolioSummary, Transaction } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { TrendingUp, TrendingDown, ArrowUpRight, Wallet, Vault, CreditCard, Landmark, Pencil, Check } from 'lucide-react';
import { XirrDetailsCard } from '@/components/XirrDetailsCard';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  summary: PortfolioSummary;
  transactions: Transaction[];
  onUpdateCash: (updates: Partial<CashSettings>, options?: { excludeFromCashflow?: boolean }) => void;
  onPayCreditCard: () => void;
}

type CashField = 'liquid' | 'vault' | 'pf' | 'debt';

// Only these two are real bank balances for income/expense tracking purposes
// (see src/lib/expenseIncomeRatio.ts) — PF and credit-card-debt edits never
// show the "exclude from tracking" toggle.
const CASHFLOW_TRACKED_FIELDS: CashField[] = ['liquid', 'vault'];

export function SummaryBar({ summary, transactions, onUpdateCash, onPayCreditCard }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const pnlPositive = summary.totalPnl >= 0;

  const [editing, setEditing] = useState<CashField | null>(null);
  const [inputVal, setInputVal] = useState('');
  const [excludeFromCashflow, setExcludeFromCashflow] = useState(false);

  const fieldValue = (field: CashField) =>
    field === 'liquid' ? summary.liquidCash :
    field === 'vault' ? summary.vaultCash :
    field === 'pf' ? summary.pfBalance :
    summary.creditCardDebt;

  const startEdit = (field: CashField) => {
    setEditing(field);
    setInputVal(fieldValue(field).toString());
    setExcludeFromCashflow(false);
  };

  const save = () => {
    const val = parseFloat(inputVal);
    if (!isNaN(val) && val >= 0 && editing) {
      const key =
        editing === 'liquid' ? 'liquidCash' :
        editing === 'vault' ? 'vaultCash' :
        editing === 'pf' ? 'pfBalance' :
        'creditCardDebt';
      const options = CASHFLOW_TRACKED_FIELDS.includes(editing) ? { excludeFromCashflow } : undefined;
      onUpdateCash({ [key]: val } as Partial<CashSettings>, options);
    }
    setEditing(null);
  };

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

      {/* Cash row — Operating Cash / Cash Reserve / PF / Outstanding Liabilities are
          editable in place (moved here from the old Cash Management section); Principal
          Capital Allocated is a derived figure, so it stays read-only. */}
      <div className="lg:col-span-12 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <EditableMiniStat
          icon={<Wallet className="w-3.5 h-3.5" />}
          label="Operating Cash"
          value={fmt(summary.liquidCash)}
          editing={editing === 'liquid'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('liquid')}
          onSave={save}
          showExcludeToggle
          excludeChecked={excludeFromCashflow}
          onExcludeChange={setExcludeFromCashflow}
        />
        <EditableMiniStat
          icon={<Vault className="w-3.5 h-3.5" />}
          label="Cash Reserve"
          value={fmt(summary.vaultCash)}
          editing={editing === 'vault'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('vault')}
          onSave={save}
          showExcludeToggle
          excludeChecked={excludeFromCashflow}
          onExcludeChange={setExcludeFromCashflow}
        />
        <EditableMiniStat
          icon={<Landmark className="w-3.5 h-3.5" />}
          label="PF (PPF/EPF)"
          value={fmt(summary.pfBalance)}
          editing={editing === 'pf'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('pf')}
          onSave={save}
        />
        <EditableMiniStat
          icon={<CreditCard className="w-3.5 h-3.5" />}
          label="Outstanding Liabilities"
          value={summary.creditCardDebt > 0 ? `−${fmt(summary.creditCardDebt)}` : fmt(0)}
          tone={summary.creditCardDebt > 0 ? 'loss' : 'default'}
          editing={editing === 'debt'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('debt')}
          onSave={save}
          showSettle={summary.creditCardDebt > 0}
          onSettle={onPayCreditCard}
          settleDisabled={summary.vaultCash < summary.creditCardDebt}
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

/** Same footprint as `MiniStat` at rest — grows in place only while editing (or when
 * "Settle Now" is shown for an outstanding liability), matching the other cash boxes. */
function EditableMiniStat({
  icon,
  label,
  value,
  tone = 'default',
  editing,
  inputVal,
  setInputVal,
  onEdit,
  onSave,
  showExcludeToggle,
  excludeChecked,
  onExcludeChange,
  showSettle,
  onSettle,
  settleDisabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'loss';
  editing: boolean;
  inputVal: string;
  setInputVal: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  /** Shown only for balances that feed the expense-to-income ratio (Operating Cash / Cash Reserve). */
  showExcludeToggle?: boolean;
  excludeChecked?: boolean;
  onExcludeChange?: (checked: boolean) => void;
  showSettle?: boolean;
  onSettle?: () => void;
  settleDisabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-secondary text-foreground flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] text-muted-foreground truncate">{label}</p>
            {!editing && (
              <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition shrink-0">
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
          {!editing && (
            <p
              className={`text-sm font-semibold tracking-tight truncate ${
                tone === 'loss' ? 'text-loss' : 'text-foreground'
              }`}
            >
              {value}
            </p>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="flex-1 px-2 py-1.5 border border-input rounded-md text-sm bg-background text-foreground"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
              autoFocus
            />
            <button onClick={onSave} className="p-1.5 rounded-md bg-foreground text-background">
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
          {showExcludeToggle && (
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={excludeChecked ?? false}
                onChange={(e) => onExcludeChange?.(e.target.checked)}
                className="rounded border-input"
              />
              Transfer or correction — exclude from income/expense
            </label>
          )}
        </div>
      )}

      {!editing && showSettle && (
        <button
          onClick={onSettle}
          disabled={settleDisabled}
          title={settleDisabled ? 'Insufficient Cash Reserve' : 'Settle outstanding liability from Cash Reserve'}
          className="mt-2 w-full text-[11px] px-2 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
        >
          <CreditCard className="w-3 h-3" /> Settle Now
        </button>
      )}
    </div>
  );
}
