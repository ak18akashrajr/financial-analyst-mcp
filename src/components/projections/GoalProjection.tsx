import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Target, Sparkles } from 'lucide-react';
import { runGoalMonteCarlo, solveRequiredSIP } from '@/lib/monteCarloAdvanced';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';


interface Goal {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
}

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function GoalProjection({
  goals,
  goalCurrentValues,
  expectedReturn,
  volatility,
  hidden,
}: {
  goals: Goal[];
  goalCurrentValues: Record<string, number>;
  expectedReturn: number; // decimal
  volatility: number;     // decimal
  hidden: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(goals[0]?.id ?? '');
  const [monthlySIP, setMonthlySIP] = useState<number>(10000);
  const [confidence, setConfidence] = useState<number>(80);
  const { selection: fanRangeSelection, handlers: fanRangeHandlers, clear: clearFanRange } = useChartRangeSelection();

  const selected = goals.find(g => g.id === selectedId);

  const yearsToTarget = useMemo(() => {
    if (!selected?.target_date) return 5;
    const t = new Date(selected.target_date).getTime();
    const y = (t - Date.now()) / (365.25 * 24 * 3600 * 1000);
    return Math.max(0.25, Math.round(y * 10) / 10);
  }, [selected]);

  const result = useMemo(() => {
    if (!selected) return null;
    return runGoalMonteCarlo({
      currentAllocated: goalCurrentValues[selected.id] ?? 0,
      monthlySIP,
      yearsToTarget,
      targetAmount: Number(selected.target_amount),
      expectedReturn,
      volatility,
    }, 800);
  }, [selected, monthlySIP, yearsToTarget, expectedReturn, volatility, goalCurrentValues]);

  const [solving, setSolving] = useState(false);
  const [solverResult, setSolverResult] = useState<{ flatSIP: number; stepUpSIP: number; achievedProb: number } | null>(null);

  function runSolver() {
    if (!selected) return;
    setSolving(true);
    setTimeout(() => {
      const r = solveRequiredSIP({
        currentAllocated: goalCurrentValues[selected.id] ?? 0,
        yearsToTarget,
        targetAmount: Number(selected.target_amount),
        expectedReturn,
        volatility,
      }, confidence / 100, 300);
      setSolverResult(r);
      setSolving(false);
    }, 20);
  }

  if (goals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <Target className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No goals yet. Create one on the Goals page to run goal-linked projections.</p>
      </div>
    );
  }

  const chartData = result?.timelines.p50.map((v, i) => ({
    year: `Y${i}`,
    p10: result.timelines.p10[i] ?? 0,
    p50: v,
    p90: result.timelines.p90[i] ?? 0,
    target: Number(selected?.target_amount ?? 0),
  })) ?? [];

  const fanRangeResult =
    fanRangeSelection.startIndex !== null && fanRangeSelection.endIndex !== null
      ? computeRangeReturn(chartData, fanRangeSelection.startIndex, fanRangeSelection.endIndex, 'p50', 'year')
      : null;

  return (
    <div className="space-y-4">
      {/* Goal Selector */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Goal" title="Goal selector" side="top">Picks a goal saved on the Goals page. Its target amount, target date and the live market value of the assets allocated to it are pulled in automatically.</LabelWithHint></label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="w-full mt-1 h-9 px-3 text-sm rounded-md border border-border bg-background"
            >
              {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Monthly SIP (₹)" title="Monthly contribution to this goal" side="top">Future monthly investment earmarked for this goal. It drives the probability above; the optimizer below solves for it instead.</LabelWithHint></label>
            <input
              type="number"
              value={monthlySIP}
              onChange={e => setMonthlySIP(Number(e.target.value) || 0)}
              className="w-full mt-1 h-9 px-3 text-sm rounded-md border border-border bg-background"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Target Confidence %" title="Target confidence" side="top" caveat="Higher confidence demands a materially larger SIP.">The success rate you want the SIP Optimizer to guarantee — 80% means only 2 in 10 simulated futures miss the goal.</LabelWithHint></label>
            <input
              type="number"
              value={confidence}
              onChange={e => setConfidence(Math.min(99, Math.max(50, Number(e.target.value) || 80)))}
              className="w-full mt-1 h-9 px-3 text-sm rounded-md border border-border bg-background"
            />
          </div>
        </div>
        {selected && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Target: <span className="text-foreground font-medium">{fmt(Number(selected.target_amount))}</span> · Currently allocated: <span className="text-foreground font-medium">{hidden ? '••••' : fmt(goalCurrentValues[selected.id] ?? 0)}</span> · Horizon: <span className="text-foreground font-medium">{yearsToTarget} yrs</span> · Assumed: <span className="text-foreground font-medium">{(expectedReturn * 100).toFixed(1)}% return / {(volatility * 100).toFixed(0)}% vol</span>
          </p>
        )}
      </div>

      {/* Probability + Stats */}
      {result && selected && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label={<LabelWithHint label="P(goal met)" title="Probability of hitting the goal" side="top" formula="share of 800 simulated paths ending ≥ target amount">Runs 800 random return paths on the money already allocated to this goal plus your SIP, and counts how many reach the target by its date.</LabelWithHint>} value={`${(result.probability * 100).toFixed(0)}%`} color={result.probability >= 0.7 ? 'text-green-500' : result.probability >= 0.4 ? 'text-yellow-500' : 'text-red-500'} />
          <StatBox label={<LabelWithHint label="Median outcome" title="Median outcome" side="top">The middle simulated corpus at the target date — half the paths finish above this, half below.</LabelWithHint>} value={hidden ? '••••' : fmt(result.p50)} />
          <StatBox label={<LabelWithHint label="Expected surplus" title="Expected surplus" side="top">Average amount by which the successful paths overshoot the target — your cushion when things go well.</LabelWithHint>} value={hidden ? '••••' : fmt(result.expectedSurplus)} color="text-green-500" />
          <StatBox label={<LabelWithHint label="Expected shortfall" title="Expected shortfall" side="top">Average gap on the paths that miss the target. This is the number to fund with a higher SIP or a longer horizon.</LabelWithHint>} value={hidden ? '••••' : fmt(result.expectedShortfall)} color="text-red-500" />
        </div>
      )}

      {/* Fan Chart */}
      {result && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            Fan chart (p10 / p50 / p90) vs target line
            <InfoHint title="Fan chart" side="right">Each line is a percentile of the 800 simulations over time: p90 optimistic, p50 median, p10 pessimistic. Where the target line sits inside the fan tells you how comfortably the goal is funded.</InfoHint>
          </h3>

          <div className="relative">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} {...fanRangeHandlers}>
                <defs>
                  <linearGradient id="gGoal90" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142,71%,45%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={70} />
                <Tooltip formatter={(v: number) => hidden ? '••••' : fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ChartRangeReferenceArea selection={fanRangeSelection} data={chartData} labelKey="year" />
                <Area type="monotone" dataKey="p90" name="p90 (optimistic)" stroke="hsl(142,71%,45%)" fill="url(#gGoal90)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="p50" name="Median" stroke="hsl(220,70%,55%)" fill="none" strokeWidth={2} />
                <Area type="monotone" dataKey="p10" name="p10 (pessimistic)" stroke="hsl(0,72%,51%)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="target" name="Target" stroke="hsl(45,93%,47%)" fill="none" strokeWidth={1.5} strokeDasharray="6 2" />
              </AreaChart>
            </ResponsiveContainer>
            <ChartRangeBadge
              selection={fanRangeSelection}
              result={fanRangeResult}
              onClear={clearFanRange}
              unit="currency"
              formatValue={fmt}
              valueLabel="Median (p50)"
            />
          </div>
        </div>
      )}

      {/* SIP Optimizer */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> SIP Optimizer</h3>
            <p className="text-[11px] text-muted-foreground">Solves the minimum monthly SIP so probability of hitting target ≥ {confidence}%.</p>
          </div>
          <button
            onClick={runSolver}
            disabled={solving || !selected}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {solving ? 'Solving…' : 'Solve required SIP'}
          </button>
        </div>
        {solverResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatBox label={<LabelWithHint label="Flat monthly SIP" title="Flat SIP required" side="top" formula="bisection search on SIP until P(target met) ≥ confidence">The smallest constant monthly contribution that gets the goal to your chosen confidence level.</LabelWithHint>} value={hidden ? '••••' : fmt(solverResult.flatSIP)} color="text-green-500" />
            <StatBox label={<LabelWithHint label="Step-up SIP (yr 1, +10%/yr)" title="Step-up SIP" side="top">Starting amount if you increase the SIP 10% every year — usually a much lower year-1 outflow than the flat plan.</LabelWithHint>} value={hidden ? '••••' : fmt(solverResult.stepUpSIP)} color="text-blue-500" />
            <StatBox label={<LabelWithHint label="Achieved probability" title="Achieved probability" side="top">The success rate the solved SIP actually delivers — it can slightly exceed your target confidence because the search steps in discrete amounts.</LabelWithHint>} value={`${(solverResult.achievedProb * 100).toFixed(0)}%`} />

          </div>
        )}
      </div>
    </div>
  );
}

const StatBox = ({ label, value, color }: { label: React.ReactNode; value: string; color?: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    <p className={`text-lg font-bold ${color || 'text-foreground'}`}>{value}</p>
  </div>
);

