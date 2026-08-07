import { useMemo, useState, useEffect } from 'react';
import type { Transaction } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { TrendingUp, Calendar, Target, Pencil, Check, X, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// Indian FY: April 1 to March 31.
function getFY(date: Date): string {
  const m = date.getMonth();
  const y = date.getFullYear();
  const startYear = m >= 3 ? y : y - 1;
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const TARGET_KEY = 'sip_monthly_target';

interface Props {
  transactions: Transaction[];
}

export function SIPSummary({ transactions }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const [target, setTarget] = useState<number>(() => {
    const v = localStorage.getItem(TARGET_KEY);
    return v ? Number(v) || 0 : 0;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(target));

  useEffect(() => { setDraft(String(target)); }, [target]);

  const saveTarget = () => {
    const n = Math.max(0, Number(draft) || 0);
    setTarget(n);
    localStorage.setItem(TARGET_KEY, String(n));
    setEditing(false);
  };

  const { thisMonthTotal, fyAverages, currentFY } = useMemo(() => {
    const now = new Date();
    const cm = now.getMonth();
    const cy = now.getFullYear();

    let thisMonthTotal = 0;
    const byFY: Record<string, { total: number; months: Set<string> }> = {};

    for (const t of transactions) {
      if (t.type !== 'BUY') continue;
      const d = new Date(t.date);
      const amt = t.quantity * t.price;
      if (d.getMonth() === cm && d.getFullYear() === cy) thisMonthTotal += amt;
      const fy = getFY(d);
      if (!byFY[fy]) byFY[fy] = { total: 0, months: new Set() };
      byFY[fy].total += amt;
      byFY[fy].months.add(`${d.getFullYear()}-${d.getMonth()}`);
    }

    const fyAverages = Object.entries(byFY)
      .map(([fy, v]) => ({ fy, total: v.total, monthsActive: v.months.size, avg: v.total / Math.max(v.months.size, 1) }))
      .sort((a, b) => b.fy.localeCompare(a.fy));

    return { thisMonthTotal, fyAverages, currentFY: getFY(now) };
  }, [transactions]);

  const progressPct = target > 0 ? Math.min(100, (thisMonthTotal / target) * 100) : 0;
  const achieved = target > 0 && thisMonthTotal >= target;
  const remaining = Math.max(0, target - thisMonthTotal);

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">SIP / Investment Activity</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* This Month + Target */}
        <div className="p-4 rounded-lg border border-border bg-card md:col-span-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" /> This Month Deployed
            </div>
          </div>
          <p className="text-xl font-semibold text-foreground">{fmt(thisMonthTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>

          {/* Target row */}
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Target className="w-3 h-3" /> Monthly Target
              </div>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit target"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button onClick={saveTarget} className="text-gain hover:opacity-80"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setDraft(String(target)); setEditing(false); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>

            {editing ? (
              <Input
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditing(false); }}
                placeholder="e.g. 50000"
                autoFocus
                className="h-8 text-sm"
              />
            ) : target > 0 ? (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-foreground">{fmt(target)}</p>
                  <p className="text-[11px] text-muted-foreground">{progressPct.toFixed(0)}%</p>
                </div>
                <Progress value={progressPct} className="h-1.5 mt-1.5" />
                {achieved ? (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-gain font-medium">
                    <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Mapla! Target smashed this month 🎯 Compounding loves consistency — keep it rolling!</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {fmt(remaining)} left to hit target
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground italic">Set a monthly target to track progress</p>
            )}
          </div>
        </div>

        {/* FY Averages */}
        <div className="md:col-span-2 p-4 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <TrendingUp className="w-3.5 h-3.5" /> Average Monthly SIP per FY
          </div>
          {fyAverages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No buy transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="font-medium py-1 pr-3">FY</th>
                    <th className="font-medium py-1 pr-3">Total Principal Allocated</th>
                    <th className="font-medium py-1 pr-3">Active Months</th>
                    <th className="font-medium py-1">Avg / Month</th>
                  </tr>
                </thead>
                <tbody>
                  {fyAverages.map(r => (
                    <tr key={r.fy} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-medium text-foreground">
                        {r.fy}{r.fy === currentFY && <span className="ml-1.5 text-[10px] text-primary">(current)</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-foreground">{fmt(r.total)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{r.monthsActive}</td>
                      <td className="py-1.5 font-semibold text-foreground">{fmt(r.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
