import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { AppNav } from '@/components/AppNav';
import { SiteFooter } from '@/components/SiteFooter';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, Target, Home, GraduationCap, Plane, Car, Heart, Briefcase, PiggyBank, CalendarDays, TrendingUp, Info, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

const ICON_OPTIONS = [
  { id: 'Target', icon: Target },
  { id: 'Home', icon: Home },
  { id: 'GraduationCap', icon: GraduationCap },
  { id: 'Plane', icon: Plane },
  { id: 'Car', icon: Car },
  { id: 'Heart', icon: Heart },
  { id: 'Briefcase', icon: Briefcase },
  { id: 'PiggyBank', icon: PiggyBank },
] as const;

const CATEGORIES = ['Retirement', 'House', 'Education', 'Travel', 'Vehicle', 'Wedding', 'Emergency Fund', 'Other'];

// Indian equity tax rates (FY 2025-26+)
const LTCG_RATE = 0.125; // > 12 months
const STCG_RATE = 0.20;  // <= 12 months
const LT_DAYS = 365;

interface Goal {
  id: string;
  name: string;
  category: string;
  target_amount: number;
  target_date: string | null;
  icon: string;
  notes: string | null;
}

interface Allocation {
  id: string;
  goal_id: string;
  source_type: 'symbol' | 'liquid_cash' | 'vault_cash';
  symbol: string | null;
  amount: number;      // rupees (used for cash sources)
  quantity: number | null; // units (used for symbol sources)
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtQty(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(n);
}

function GoalIcon({ id, className }: { id: string; className?: string }) {
  const found = ICON_OPTIONS.find((o) => o.id === id) ?? ICON_OPTIONS[0];
  const Icon = found.icon;
  return <Icon className={className} />;
}

// FIFO match SELL against BUY lots; return remaining open BUY lots {qty, price, date}
function getOpenLots(transactions: Transaction[]) {
  const buys = transactions
    .filter((t) => t.type === 'BUY')
    .map((t) => ({ qty: t.quantity, price: t.price, date: new Date(t.date) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let sellQty = transactions
    .filter((t) => t.type === 'SELL')
    .reduce((s, t) => s + t.quantity, 0);
  for (const lot of buys) {
    if (sellQty <= 0) break;
    const used = Math.min(lot.qty, sellQty);
    lot.qty -= used;
    sellQty -= used;
  }
  return buys.filter((l) => l.qty > 0);
}

// Compute long-term vs short-term invested-cost split for a holding (by FIFO open lots)
function getHoldingLotSplit(h: DerivedHolding) {
  const lots = getOpenLots(h.transactions);
  const now = Date.now();
  let longInvested = 0;
  let shortInvested = 0;
  for (const lot of lots) {
    const ageDays = (now - lot.date.getTime()) / (1000 * 60 * 60 * 24);
    const cost = lot.qty * lot.price;
    if (ageDays >= LT_DAYS) longInvested += cost;
    else shortInvested += cost;
  }
  const totalCost = longInvested + shortInvested;
  if (totalCost <= 0) return { longFrac: 0, shortFrac: 0 };
  return { longFrac: longInvested / totalCost, shortFrac: shortInvested / totalCost };
}

interface AllocTax {
  id: string;
  label: string;
  source: 'symbol' | 'liquid_cash' | 'vault_cash';
  storedQty: number;      // requested units (symbol) or 0
  effectiveQty: number;   // clamped units (symbol) or 0
  storedAmount: number;   // requested rupees (cash) or 0
  effectiveAmount: number;// clamped rupees (cash) or 0
  clamped: boolean;
  invested: number;
  market: number;
  gainLT: number;
  gainST: number;
  taxLT: number;
  taxST: number;
  tax: number;
  postTax: number;
}

// scaleMap: for each key ("cash:liquid" | "cash:vault" | `sym:${symbol}`) — factor <=1 to shrink over-allocations
function computeAllocTax(a: Allocation, holdings: DerivedHolding[], scaleMap: Record<string, number>): AllocTax {
  if (a.source_type !== 'symbol') {
    const key = a.source_type === 'liquid_cash' ? 'cash:liquid' : 'cash:vault';
    const scale = scaleMap[key] ?? 1;
    const stored = Number(a.amount) || 0;
    const eff = stored * scale;
    const label = a.source_type === 'liquid_cash' ? 'Operating Cash' : 'Cash Reserve';
    return {
      id: a.id, label, source: a.source_type,
      storedQty: 0, effectiveQty: 0,
      storedAmount: stored, effectiveAmount: eff,
      clamped: scale < 1,
      invested: eff, market: eff, gainLT: 0, gainST: 0, taxLT: 0, taxST: 0, tax: 0, postTax: eff,
    };
  }
  const h = holdings.find((x) => x.symbol === a.symbol);
  const storedQty = Number(a.quantity) || 0;
  if (!h || h.totalQuantity <= 0) {
    return {
      id: a.id, label: a.symbol ?? '—', source: 'symbol',
      storedQty, effectiveQty: 0,
      storedAmount: 0, effectiveAmount: 0,
      clamped: storedQty > 0,
      invested: 0, market: 0, gainLT: 0, gainST: 0, taxLT: 0, taxST: 0, tax: 0, postTax: 0,
    };
  }
  const scale = scaleMap[`sym:${a.symbol}`] ?? 1;
  const effectiveQty = storedQty * scale;
  const invested = effectiveQty * h.avgPrice;
  const market = effectiveQty * h.currentPrice;
  const { longFrac, shortFrac } = getHoldingLotSplit(h);
  const investedLT = invested * longFrac;
  const investedST = invested * shortFrac;
  const marketLT = market * longFrac;
  const marketST = market * shortFrac;
  const gainLT = Math.max(0, marketLT - investedLT);
  const gainST = Math.max(0, marketST - investedST);
  const taxLT = gainLT * LTCG_RATE;
  const taxST = gainST * STCG_RATE;
  const tax = taxLT + taxST;
  return {
    id: a.id, label: a.symbol ?? '—', source: 'symbol',
    storedQty, effectiveQty,
    storedAmount: 0, effectiveAmount: 0,
    clamped: scale < 1,
    invested, market, gainLT, gainST, taxLT, taxST, tax, postTax: market - tax,
  };
}

// Build a scale-map so per-source over-allocations shrink pro-rata to available.
function buildScaleMap(
  allocations: Allocation[],
  holdings: DerivedHolding[],
  cash: { liquidCash: number; vaultCash: number },
): Record<string, number> {
  const totals: Record<string, number> = {};
  const capacity: Record<string, number> = {
    'cash:liquid': cash.liquidCash,
    'cash:vault': cash.vaultCash,
  };
  for (const a of allocations) {
    if (a.source_type === 'liquid_cash') totals['cash:liquid'] = (totals['cash:liquid'] || 0) + (Number(a.amount) || 0);
    else if (a.source_type === 'vault_cash') totals['cash:vault'] = (totals['cash:vault'] || 0) + (Number(a.amount) || 0);
    else if (a.symbol) {
      const key = `sym:${a.symbol}`;
      totals[key] = (totals[key] || 0) + (Number(a.quantity) || 0);
      if (!(key in capacity)) {
        const h = holdings.find((x) => x.symbol === a.symbol);
        capacity[key] = h ? h.totalQuantity : 0;
      }
    }
  }
  const map: Record<string, number> = {};
  for (const key of Object.keys(totals)) {
    const t = totals[key];
    const c = capacity[key] ?? 0;
    map[key] = t > 0 && t > c ? Math.max(0, c / t) : 1;
  }
  return map;
}


function GoalTrackContent() {
  const { hidden } = usePrivacy();
  const { holdings, cash, loading } = usePortfolio();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  // form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Retirement');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [icon, setIcon] = useState('Target');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const [g, a] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: true }),
      supabase.from('goal_allocations').select('*'),
    ]);
    if (g.data) setGoals(g.data as Goal[]);
    if (a.data) setAllocations(a.data as Allocation[]);
  }

  async function createGoal() {
    if (!name.trim() || !targetAmount) {
      toast.error('Name and target amount are required');
      return;
    }
    const { error } = await supabase.from('goals').insert({
      name: name.trim(),
      category,
      target_amount: Number(targetAmount),
      target_date: targetDate || null,
      icon,
      notes: notes.trim() || null,
    });
    if (error) {
      toast.error('Failed to create goal');
      return;
    }
    toast.success('Goal created');
    setName(''); setTargetAmount(''); setTargetDate(''); setNotes('');
    setShowForm(false);
    await load();
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal and all its allocations?')) return;
    await supabase.from('goals').delete().eq('id', id);
    await load();
  }

  async function updateGoal(id: string, patch: Partial<Omit<Goal, 'id'>>) {
    const { error } = await supabase.from('goals').update(patch).eq('id', id);
    if (error) {
      toast.error('Failed to update goal');
      return;
    }
    toast.success('Goal updated');
    setEditingGoal(null);
    await load();
  }


  async function addAllocation(
    goalId: string,
    sourceType: 'symbol' | 'liquid_cash' | 'vault_cash',
    symbol: string | null,
    value: number,
  ) {
    if (value <= 0) return;
    // Explicitly typed to match the goal_allocations Insert shape as one flat
    // type — without this, TS infers a union of two distinct object-literal
    // shapes from the ternary, which Supabase's excess-property-checking
    // insert() overload can't reconcile against a single table row shape.
    const payload: {
      goal_id: string;
      source_type: 'symbol' | 'liquid_cash' | 'vault_cash';
      symbol: string | null;
      amount: number;
      quantity: number | null;
    } =
      sourceType === 'symbol'
        ? { goal_id: goalId, source_type: sourceType, symbol, amount: 0, quantity: value }
        : { goal_id: goalId, source_type: sourceType, symbol: null, amount: value, quantity: null };
    await supabase.from('goal_allocations').insert(payload);
    await load();
  }

  async function removeAllocation(id: string) {
    await supabase.from('goal_allocations').delete().eq('id', id);
    await load();
  }

  const scaleMap = useMemo(
    () => buildScaleMap(allocations, holdings, cash),
    [allocations, holdings, cash],
  );

  // Compute progress with LT/ST split tax and live auto-sync (scaleMap clamps over-allocations)
  const goalProgress = useMemo(() => {
    const map: Record<string, { current: number; postTax: number; tax: number; invested: number }> = {};
    for (const goal of goals) map[goal.id] = { current: 0, postTax: 0, tax: 0, invested: 0 };
    for (const a of allocations) {
      const r = computeAllocTax(a, holdings, scaleMap);
      const m = map[a.goal_id];
      if (!m) continue;
      m.current += r.market;
      m.postTax += r.postTax;
      m.tax += r.tax;
      m.invested += r.invested;
    }
    return map;
  }, [goals, allocations, holdings, scaleMap]);


  const openGoal = goals.find((g) => g.id === openGoalId) || null;
  const openAllocs = openGoalId ? allocations.filter((a) => a.goal_id === openGoalId) : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <AppNav />

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Goal-Based Investing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tag investments to goals and track your progress. Click any goal card for details.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> New Goal
          </button>
        </div>

        {showForm && (
          <div className="rounded-lg border border-border bg-card p-4 mb-6 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <input className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retirement Corpus" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <select className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Target Amount (₹) — post-tax</label>
                <input type="number" className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="10000000" />
                <p className="text-[10px] text-muted-foreground mt-1">Amount you want in-hand after taxes. Progress shows estimated post-tax value.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Target Date</label>
                <input type="date" className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Icon</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {ICON_OPTIONS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setIcon(id)}
                    className={`p-2 rounded-md border transition-colors ${icon === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2">
              <button onClick={createGoal} className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90">Create Goal</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent">Cancel</button>
            </div>
          </div>
        )}

        {goals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No goals yet. Create your first one to start tracking.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {goals.map((goal) => {
              const prog = goalProgress[goal.id] || { current: 0, postTax: 0, tax: 0, invested: 0 };
              const target = Number(goal.target_amount);
              const pct = target > 0 ? Math.min(100, (prog.postTax / target) * 100) : 0;
              const goalAllocs = allocations.filter((a) => a.goal_id === goal.id);
              return (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  current={prog.current}
                  postTax={prog.postTax}
                  tax={prog.tax}
                  target={target}
                  pct={pct}
                  hidden={hidden}
                  allocations={goalAllocs}
                  allAllocations={allocations}
                  scaleMap={scaleMap}
                  holdings={holdings}
                  cash={cash}
                  onAddAllocation={addAllocation}
                  onRemoveAllocation={removeAllocation}
                  onDelete={() => deleteGoal(goal.id)}
                  onEdit={() => setEditingGoal(goal)}
                  onOpenDetails={() => setOpenGoalId(goal.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      <EditGoalDialog goal={editingGoal} onClose={() => setEditingGoal(null)} onSave={updateGoal} />


      <GoalDetailDialog
        goal={openGoal}
        allocations={openAllocs}
        holdings={holdings}
        scaleMap={scaleMap}
        progress={openGoalId ? goalProgress[openGoalId] : null}
        hidden={hidden}
        onClose={() => setOpenGoalId(null)}
      />

      <SiteFooter />
    </div>
  );
}


function GoalCard({
  goal, current, postTax, tax, target, pct, hidden, allocations, allAllocations, scaleMap, holdings, cash,
  onAddAllocation, onRemoveAllocation, onDelete, onEdit, onOpenDetails,
}: {
  goal: Goal; current: number; postTax: number; tax: number; target: number; pct: number; hidden: boolean;
  allocations: Allocation[];
  allAllocations: Allocation[];
  scaleMap: Record<string, number>;
  holdings: DerivedHolding[];
  cash: { liquidCash: number; vaultCash: number };
  onAddAllocation: (goalId: string, sourceType: 'symbol' | 'liquid_cash' | 'vault_cash', symbol: string | null, value: number) => Promise<void>;
  onRemoveAllocation: (id: string) => Promise<void>;
  onDelete: () => void;
  onEdit: () => void;
  onOpenDetails: () => void;
}) {
  const [source, setSource] = useState<string>('liquid_cash');
  const [amount, setAmount] = useState('');

  const isCashSource = source === 'liquid_cash' || source === 'vault_cash';

  // Sum of stored allocation across ALL goals for this source (so per-goal input caps at true remaining capacity)
  const usedFromSource = useMemo(() => {
    if (source === 'liquid_cash') return allAllocations.filter((a) => a.source_type === 'liquid_cash').reduce((s, a) => s + Number(a.amount || 0), 0);
    if (source === 'vault_cash') return allAllocations.filter((a) => a.source_type === 'vault_cash').reduce((s, a) => s + Number(a.amount || 0), 0);
    return allAllocations.filter((a) => a.source_type === 'symbol' && a.symbol === source).reduce((s, a) => s + Number(a.quantity || 0), 0);
  }, [allAllocations, source]);

  const sourceCapacity = useMemo(() => {
    if (source === 'liquid_cash') return cash.liquidCash;
    if (source === 'vault_cash') return cash.vaultCash;
    const h = holdings.find((x) => x.symbol === source);
    return h ? h.totalQuantity : 0;
  }, [source, cash, holdings]);

  const available = Math.max(0, sourceCapacity - usedFromSource);

  async function add() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    if (source === 'liquid_cash') await onAddAllocation(goal.id, 'liquid_cash', null, amt);
    else if (source === 'vault_cash') await onAddAllocation(goal.id, 'vault_cash', null, amt);
    else await onAddAllocation(goal.id, 'symbol', source, amt);
    setAmount('');
  }

  // Days left
  const daysLeft = useMemo(() => {
    if (!goal.target_date) return null;
    const ms = new Date(goal.target_date).getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }, [goal.target_date]);

  const rows = allocations.map((a) => computeAllocTax(a, holdings, scaleMap));
  const anyClamped = rows.some((r) => r.clamped);

  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={onOpenDetails}
          className="flex items-start gap-3 text-left flex-1 group"
        >
          <div className="p-2.5 rounded-md bg-primary/10 text-primary">
            <GoalIcon id={goal.icon} className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">{goal.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{goal.category}</span>
              {goal.target_date && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  by {new Date(goal.target_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  {daysLeft !== null && (
                    <span className={daysLeft < 0 ? 'text-destructive' : ''}>· {daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d left`}</span>
                  )}
                </span>
              )}
              <span className="text-[10px] text-primary inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Info className="w-3 h-3" /> details
              </span>
            </div>
            {goal.notes && <p className="text-xs text-muted-foreground mt-1">{goal.notes}</p>}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="text-muted-foreground hover:text-primary" title="Edit goal">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Delete goal">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">Progress (post-tax, live)</span>
          <span className="text-xs font-medium text-foreground">
            {hidden ? '•••' : `${fmt(postTax)} / ${fmt(target)}`} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'hsl(var(--gain))' : 'hsl(var(--primary))' }}
          />
        </div>
        {!hidden && tax > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Market value {fmt(current)} · est. tax {fmt(tax)} (LTCG 12.5% / STCG 20%) — click card for breakdown
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Allocations (auto-synced to live valuation)</p>
            {anyClamped && (
              <span className="text-[10px] text-destructive">clamped to available</span>
            )}
          </div>
          {rows.map((r) => {
            const a = allocations.find((x) => x.id === r.id)!;
            const isSym = r.source === 'symbol';
            return (
              <div key={r.id} className="flex items-center justify-between text-xs px-3 py-2 rounded bg-muted/50">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {r.label}{isSym ? '' : ' (cash)'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {isSym
                      ? `${fmtQty(r.effectiveQty)}${r.clamped ? ` of ${fmtQty(r.storedQty)}` : ''} units · cost ${hidden ? '•••' : fmt(r.invested)}`
                      : `earmarked${r.clamped ? ` ${fmt(r.effectiveAmount)} of ${fmt(r.storedAmount)}` : ''}`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-foreground font-medium">{hidden ? '•••' : fmt(r.market)}</span>
                  <button onClick={() => onRemoveAllocation(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-[11px] text-muted-foreground mb-2">
          For holdings, earmark a number of <span className="text-foreground">units</span> — invested cost and market value auto-sync with live price and quantity. For cash, earmark a rupee amount — auto-clamped if the underlying balance drops.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">Source</label>
            <select className="w-full mt-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background" value={source} onChange={(e) => { setSource(e.target.value); setAmount(''); }}>
              <option value="liquid_cash">Operating Cash (₹{cash.liquidCash.toLocaleString('en-IN')})</option>
              <option value="vault_cash">Cash Reserve (₹{cash.vaultCash.toLocaleString('en-IN')})</option>
              {holdings.map((h) => (
                <option key={h.symbol} value={h.symbol}>{h.symbol} ({fmtQty(h.totalQuantity)} units)</option>
              ))}
            </select>
          </div>
          <div className="w-44">
            <label className="text-xs text-muted-foreground flex items-center justify-between">
              <span>{isCashSource ? 'Amount (₹)' : 'Units'}</span>
              <button
                type="button"
                onClick={() => setAmount(isCashSource ? String(Math.round(available)) : String(available))}
                className="text-[10px] text-primary hover:underline"
                disabled={available <= 0}
              >
                Use max
              </button>
            </label>
            <input type="number" step="any" className="w-full mt-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={isCashSource ? '50000' : '10'} />
            <p className="text-[10px] text-muted-foreground mt-1">
              Available: {isCashSource ? `₹${available.toLocaleString('en-IN')}` : `${fmtQty(available)} units`}
            </p>
          </div>
          <button onClick={add} className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90">
            Allocate
          </button>
        </div>
      </div>
    </div>
  );
}


function GoalDetailDialog({
  goal, allocations, holdings, scaleMap, progress, hidden, onClose,
}: {
  goal: Goal | null;
  allocations: Allocation[];
  holdings: DerivedHolding[];
  scaleMap: Record<string, number>;
  progress: { current: number; postTax: number; tax: number; invested: number } | null;
  hidden: boolean;
  onClose: () => void;
}) {
  const breakdown = useMemo(
    () => allocations.map((a) => computeAllocTax(a, holdings, scaleMap)),
    [allocations, holdings, scaleMap]
  );


  if (!goal || !progress) return null;
  const target = Number(goal.target_amount);
  const pct = target > 0 ? Math.min(100, (progress.postTax / target) * 100) : 0;
  const totalInvested = breakdown.reduce((s, r) => s + r.invested, 0);
  const totalLTGain = breakdown.reduce((s, r) => s + r.gainLT, 0);
  const totalSTGain = breakdown.reduce((s, r) => s + r.gainST, 0);
  const totalLTTax = breakdown.reduce((s, r) => s + r.taxLT, 0);
  const totalSTTax = breakdown.reduce((s, r) => s + r.taxST, 0);

  // date math
  const today = new Date();
  const targetDate = goal.target_date ? new Date(goal.target_date) : null;
  const daysLeft = targetDate ? Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const totalDays = targetDate ? Math.ceil((targetDate.getTime() - new Date(goal.icon ? goal.icon : today).getTime()) / (1000 * 60 * 60 * 24)) : null;
  // Use created_at proxy via target's distance from now relative to original span: we use 365 default if no created
  // Simpler: percent of time elapsed since "today - 1 year" anchor — but more honest: just show days left vs target span from now to target
  const timeProgressPct = (() => {
    if (!targetDate) return null;
    // assume goal "started" 365 days before target if no other anchor; cap at 100%
    const total = Math.max(1, (targetDate.getTime() - (targetDate.getTime() - 365 * 86400000)) / 86400000); // 365
    const elapsed = 365 - Math.max(0, daysLeft ?? 0);
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  })();

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GoalIcon id={goal.icon} className="w-5 h-5 text-primary" />
            {goal.name}
            <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-normal">{goal.category}</span>
          </DialogTitle>
          {goal.notes && <DialogDescription>{goal.notes}</DialogDescription>}
        </DialogHeader>

        {/* Timeline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Target Date</p>
            <p className="text-sm font-semibold text-foreground mt-1">
              {targetDate ? targetDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Days Left</p>
            <p className={`text-sm font-semibold mt-1 ${daysLeft !== null && daysLeft < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {daysLeft === null ? '—' : daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft} days`}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Time Used (1y window)</p>
            <p className="text-sm font-semibold text-foreground mt-1">
              {timeProgressPct === null ? '—' : `${timeProgressPct.toFixed(0)}%`}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Goal Progress</p>
            <p className="text-sm font-semibold text-foreground mt-1">{pct.toFixed(1)}%</p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Post-tax progress vs target</span>
            <span className="text-xs font-medium text-foreground">
              {hidden ? '•••' : `${fmt(progress.postTax)} / ${fmt(target)}`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'hsl(var(--gain))' : 'hsl(var(--primary))' }}
            />
          </div>
        </div>

        {/* Headline metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Invested (cost)" value={hidden ? '•••' : fmt(totalInvested)} />
          <Metric label="Market Value" value={hidden ? '•••' : fmt(progress.current)} />
          <Metric label="Est. Tax" value={hidden ? '•••' : fmt(progress.tax)} tone="destructive" />
          <Metric label="Post-Tax Value" value={hidden ? '•••' : fmt(progress.postTax)} tone="gain" />
        </div>

        {/* Tax concept callout */}
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground inline-flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> How tax is estimated
          </p>
          <p>
            For each equity allocation we split the invested cost into <span className="text-foreground">long-term</span> (held ≥ 12 months) and <span className="text-foreground">short-term</span> (&lt; 12 months) using FIFO open lots, then apply:
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><span className="text-foreground">LTCG 12.5%</span> on long-term gains (Indian equity, FY 2025-26)</li>
            <li><span className="text-foreground">STCG 20%</span> on short-term gains</li>
            <li>Cash sources (Liquid / Vault) — no tax applied</li>
          </ul>
          <p className="text-[10px]">Estimates only — exclude exemptions (₹1.25L LTCG threshold), surcharges, indexation, or non-equity assets.</p>
        </div>

        {/* Per-allocation breakdown */}
        {breakdown.length > 0 ? (
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-2 font-medium">Source</th>
                  <th className="text-right px-2 py-2 font-medium">Invested</th>
                  <th className="text-right px-2 py-2 font-medium">Market</th>
                  <th className="text-right px-2 py-2 font-medium">LT Gain</th>
                  <th className="text-right px-2 py-2 font-medium">ST Gain</th>
                  <th className="text-right px-2 py-2 font-medium">LTCG 12.5%</th>
                  <th className="text-right px-2 py-2 font-medium">STCG 20%</th>
                  <th className="text-right px-2 py-2 font-medium">Post-Tax</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-1.5 text-foreground">
                      {r.label}
                      {r.source !== 'symbol' && <span className="ml-1 text-[9px] text-muted-foreground">(cash)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-foreground">{hidden ? '•••' : fmt(r.invested)}</td>
                    <td className="px-2 py-1.5 text-right text-foreground">{hidden ? '•••' : fmt(r.market)}</td>
                    <td className={`px-2 py-1.5 text-right ${r.gainLT > 0 ? 'text-[hsl(var(--gain))]' : 'text-muted-foreground'}`}>{hidden ? '•••' : fmt(r.gainLT)}</td>
                    <td className={`px-2 py-1.5 text-right ${r.gainST > 0 ? 'text-[hsl(var(--gain))]' : 'text-muted-foreground'}`}>{hidden ? '•••' : fmt(r.gainST)}</td>
                    <td className="px-2 py-1.5 text-right text-destructive">{r.taxLT > 0 ? (hidden ? '•••' : fmt(r.taxLT)) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-destructive">{r.taxST > 0 ? (hidden ? '•••' : fmt(r.taxST)) : '—'}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-foreground">{hidden ? '•••' : fmt(r.postTax)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-muted/40 font-medium">
                  <td className="px-2 py-2 text-foreground">Total</td>
                  <td className="px-2 py-2 text-right">{hidden ? '•••' : fmt(totalInvested)}</td>
                  <td className="px-2 py-2 text-right">{hidden ? '•••' : fmt(progress.current)}</td>
                  <td className="px-2 py-2 text-right">{hidden ? '•••' : fmt(totalLTGain)}</td>
                  <td className="px-2 py-2 text-right">{hidden ? '•••' : fmt(totalSTGain)}</td>
                  <td className="px-2 py-2 text-right text-destructive">{hidden ? '•••' : fmt(totalLTTax)}</td>
                  <td className="px-2 py-2 text-right text-destructive">{hidden ? '•••' : fmt(totalSTTax)}</td>
                  <td className="px-2 py-2 text-right">{hidden ? '•••' : fmt(progress.postTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">No allocations yet — earmark cash or holdings to this goal.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'destructive' }) {
  const color = tone === 'gain' ? 'text-[hsl(var(--gain))]' : tone === 'destructive' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function EditGoalDialog({
  goal, onClose, onSave,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Omit<Goal, 'id'>>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Retirement');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [icon, setIcon] = useState('Target');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!goal) return;
    setName(goal.name);
    setCategory(goal.category);
    setTargetAmount(String(goal.target_amount));
    setTargetDate(goal.target_date ?? '');
    setIcon(goal.icon);
    setNotes(goal.notes ?? '');
  }, [goal]);

  if (!goal) return null;

  const submit = async () => {
    if (!name.trim() || !targetAmount) {
      toast.error('Name and target amount are required');
      return;
    }
    await onSave(goal.id, {
      name: name.trim(),
      category,
      target_amount: Number(targetAmount),
      target_date: targetDate || null,
      icon,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Goal</DialogTitle>
          <DialogDescription>Update the details of this goal. Allocations are preserved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <input className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Category</label>
              <select className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Target Amount (₹) — post-tax</label>
              <input type="number" className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Target Date</label>
              <input type="date" className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Icon</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ICON_OPTIONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setIcon(id)}
                  className={`p-2 rounded-md border transition-colors ${icon === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent">Cancel</button>
            <button onClick={submit} className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90">Save changes</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


const GoalTrack = () => (
  <PrivacyProvider>
    <GoalTrackContent />
  </PrivacyProvider>
);

export default GoalTrack;
