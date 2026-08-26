import { useState } from 'react';
import type { CashSettings } from '@/types/portfolio';
import { Pencil, Check, CreditCard, Wallet, Vault, Landmark } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  cash: CashSettings;
  onUpdate: (updates: Partial<CashSettings>, options?: { excludeFromCashflow?: boolean }) => void;
  onPayCreditCard?: () => void;
}

type Field = 'liquid' | 'vault' | 'pf' | 'debt';

// Only these two are real bank balances for income/expense tracking purposes
// (see src/lib/expenseIncomeRatio.ts) — PF and credit-card-debt edits never
// show the "exclude from tracking" toggle.
const CASHFLOW_TRACKED_FIELDS: Field[] = ['liquid', 'vault'];

export function CashSection({ cash, onUpdate, onPayCreditCard }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const [editing, setEditing] = useState<Field | null>(null);
  const [inputVal, setInputVal] = useState('');
  const [excludeFromCashflow, setExcludeFromCashflow] = useState(false);

  const startEdit = (field: Field) => {
    setEditing(field);
    const v =
      field === 'liquid' ? cash.liquidCash :
      field === 'vault' ? cash.vaultCash :
      field === 'pf' ? cash.pfBalance :
      cash.creditCardDebt;
    setInputVal(v.toString());
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
      onUpdate({ [key]: val } as Partial<CashSettings>, options);
    }
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Cash Management</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Credit Card – visa style */}
        <DebtCard
          value={cash.creditCardDebt}
          vaultCash={cash.vaultCash}
          editing={editing === 'debt'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('debt')}
          onSave={save}
          fmt={fmt}
          onPayCreditCard={onPayCreditCard}
        />

        {/* Liquid */}
        <CashCard
          icon={<Wallet className="w-4 h-4" />}
          label="Operating Cash"
          subtitle="Available to deploy"
          value={cash.liquidCash}
          editing={editing === 'liquid'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('liquid')}
          onSave={save}
          fmt={fmt}
          showExcludeToggle
          excludeChecked={excludeFromCashflow}
          onExcludeChange={setExcludeFromCashflow}
        />

        {/* Vault */}
        <CashCard
          icon={<Vault className="w-4 h-4" />}
          label="Cash Reserve"
          subtitle="ICICI savings"
          value={cash.vaultCash}
          editing={editing === 'vault'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('vault')}
          onSave={save}
          fmt={fmt}
          showExcludeToggle
          excludeChecked={excludeFromCashflow}
          onExcludeChange={setExcludeFromCashflow}
        />

        {/* PF — long-term retirement savings */}
        <CashCard
          icon={<Landmark className="w-4 h-4" />}
          label="PF Account"
          subtitle="PPF / EPF · long-term"
          value={cash.pfBalance}
          editing={editing === 'pf'}
          inputVal={inputVal}
          setInputVal={setInputVal}
          onEdit={() => startEdit('pf')}
          onSave={save}
          fmt={fmt}
        />
      </div>
    </div>
  );
}


interface CardProps {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  value: number;
  editing: boolean;
  inputVal: string;
  setInputVal: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  fmt: (n: number) => string;
  /** Shown only for balances that feed the expense-to-income ratio (Operating Cash / Cash Reserve). */
  showExcludeToggle?: boolean;
  excludeChecked?: boolean;
  onExcludeChange?: (checked: boolean) => void;
}

function CashCard({ icon, label, subtitle, value, editing, inputVal, setInputVal, onEdit, onSave, fmt, showExcludeToggle, excludeChecked, onExcludeChange }: CardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 hover:border-foreground/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-foreground">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {!editing && (
          <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="mt-5">
        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="flex-1 px-3 py-2 border border-input rounded-md text-base bg-background text-foreground"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSave()}
                autoFocus
              />
              <button onClick={onSave} className="p-2 rounded-md bg-foreground text-background">
                <Check className="w-4 h-4" />
              </button>
            </div>
            {showExcludeToggle && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
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
        ) : (
          <p className="text-2xl font-semibold tracking-tight text-foreground">{fmt(value)}</p>
        )}
      </div>
    </div>
  );
}

interface DebtCardProps {
  value: number;
  /** Cash Reserve balance — settling the liability is disabled if it can't cover `value`. */
  vaultCash: number;
  editing: boolean;
  inputVal: string;
  setInputVal: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  fmt: (n: number) => string;
  onPayCreditCard?: () => void;
}

function DebtCard({ value, vaultCash, editing, inputVal, setInputVal, onEdit, onSave, fmt, onPayCreditCard }: DebtCardProps) {
  // Visa-style card from image-2
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br from-foreground via-foreground to-foreground/85 text-background shadow-lg min-h-[180px] flex flex-col justify-between">
      <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-background/5 blur-2xl pointer-events-none" />
      <div className="absolute -right-4 bottom-2 w-28 h-28 rounded-full bg-background/5 blur-xl pointer-events-none" />

      <div className="flex items-start justify-between relative">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-background/15 flex items-center justify-center">
            <CreditCard className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] opacity-70">Outstanding Liabilities</p>
            <p className="text-xs opacity-90">ICICI Platinum Chip</p>
          </div>
        </div>
        <span className="font-mono italic font-semibold tracking-tight text-sm opacity-90">VISA</span>
      </div>

      <div className="relative">
        <p className="font-mono tracking-[0.25em] text-sm opacity-80 mb-3">•••• •••• •••• ••••</p>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="flex-1 px-3 py-2 border border-background/30 rounded-md text-base bg-background/10 text-background placeholder:text-background/50"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
              autoFocus
            />
            <button onClick={onSave} className="p-2 rounded-md bg-background text-foreground">
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] opacity-60 mb-0.5">Outstanding</p>
              <p className={`text-2xl font-semibold tracking-tight ${value > 0 ? '' : 'opacity-70'}`}>
                {value > 0 ? '−' : ''}{fmt(value)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={onEdit}
                className="text-xs px-2.5 py-1.5 rounded-md bg-background/10 hover:bg-background/20 transition flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              {value > 0 && onPayCreditCard && (
                <button
                  onClick={onPayCreditCard}
                  disabled={vaultCash < value}
                  className="text-xs px-2.5 py-1.5 rounded-md bg-background text-foreground hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  title={vaultCash < value ? 'Insufficient Cash Reserve' : 'Settle outstanding liability from Cash Reserve'}
                >
                  <CreditCard className="w-3 h-3" /> Settle Now
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
