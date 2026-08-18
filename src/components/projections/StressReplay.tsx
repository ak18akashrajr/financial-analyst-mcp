import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { CRISIS_WINDOWS, replayCrisis } from '@/lib/monteCarloAdvanced';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';

type CrisisResult = ReturnType<typeof replayCrisis>;


function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function StressReplay({
  currentAUM,
  equityWeight,
  hidden,
}: {
  currentAUM: number;
  equityWeight: number; // 0..1
  hidden: boolean;
}) {
  const [weight, setWeight] = useState(Math.round(equityWeight * 100));

  const results = useMemo(() => {
    return (Object.keys(CRISIS_WINDOWS) as (keyof typeof CRISIS_WINDOWS)[])
      .map(k => replayCrisis(currentAUM, weight / 100, k));
  }, [currentAUM, weight]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground text-sm mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-500" /> Historical Stress Replay</p>
        <p>What would happen to your AUM of <strong className="text-foreground">{hidden ? '••••' : fmt(currentAUM)}</strong> (equity weight <strong className="text-foreground">{weight}%</strong>) if a past crisis repeated <em>right now</em>? Uses monthly NIFTY 50 returns from each window; the non-equity portion is held flat (conservative — real bonds/gold usually rose in these events).</p>
        <p className="mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span><strong>Approximation notice:</strong> Monthly returns are compressed from published NIFTY history. A future upgrade will replay day-level series from your `historical_prices` table.</span></p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <LabelWithHint label="Equity Weight for Simulation (%)" title="Equity weight" side="top" caveat="Non-equity holdings are held flat — in real crises bonds and gold often rose, so this is deliberately conservative.">
            Portion of your AUM the crisis returns are applied to. Defaults to your live equity exposure; drag it to test a more or less aggressive book.
          </LabelWithHint>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={weight}
          onChange={e => setWeight(Number(e.target.value))}
          className="w-full mt-2 accent-primary"
        />
        <p className="text-[11px] text-muted-foreground mt-1">Currently: <span className="text-foreground font-medium">{weight}%</span></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {results.map(r => (
          <StressCrisisCard key={r.key} r={r} hidden={hidden} />
        ))}
      </div>
    </div>
  );
}

function StressCrisisCard({ r, hidden }: { r: CrisisResult; hidden: boolean }) {
  const { selection, handlers, clear } = useChartRangeSelection();
  const rangeResult =
    selection.startIndex !== null && selection.endIndex !== null
      ? computeRangeReturn(r.timeline, selection.startIndex, selection.endIndex, 'value', 'month')
      : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          {r.label}
          <InfoHint title={r.label} side="top">Applies the month-by-month NIFTY 50 returns recorded during this crisis window to your equity sleeve, starting from today's AUM.</InfoHint>
        </h3>
        <p className="text-[11px] text-muted-foreground">{r.window}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label={<LabelWithHint label="Max drawdown" title="Max drawdown" side="top" formula="(trough − peak) ÷ peak">Deepest peak-to-trough fall in portfolio value during the replay.</LabelWithHint>} value={`${(r.maxDrawdown * 100).toFixed(1)}%`} color="text-red-500" />
        <MiniStat label={<LabelWithHint label="Trough value" title="Trough value" side="top">The lowest rupee value your portfolio touches during the window — the number you would actually have to sit through.</LabelWithHint>} value={hidden ? '••••' : fmt(r.troughValue)} color="text-orange-500" />
        <MiniStat label={<LabelWithHint label="End value" title="End value" side="top">Portfolio value at the end of the crisis window, after any rebound inside that period.</LabelWithHint>} value={hidden ? '••••' : fmt(r.endValue)} />
        <MiniStat label={<LabelWithHint label="Recovery @ 12%" title="Recovery time" side="top" formula="months of 12% p.a. compounding to regain the starting AUM">How long it would take to get back to where you started, assuming a 12% annual recovery and no fresh contributions.</LabelWithHint>} value={r.recoveryMonths === null ? 'N/A' : r.recoveryMonths === 0 ? 'Already recovered' : `${r.recoveryMonths} mo`} color="text-yellow-500" />
      </div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={r.timeline} {...handlers}>
            <defs>
              <linearGradient id={`gStress-${r.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0,72%,51%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(0,72%,51%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
            <XAxis dataKey="month" tick={{ fontSize: 9 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 9 }} className="fill-muted-foreground" width={55} />
            <Tooltip formatter={(v: number) => hidden ? '••••' : fmt(v)} labelFormatter={(m) => `Month ${m}`} />
            <ChartRangeReferenceArea selection={selection} data={r.timeline} labelKey="month" />
            <Area type="monotone" dataKey="value" stroke="hsl(0,72%,51%)" fill={`url(#gStress-${r.key})`} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        <ChartRangeBadge selection={selection} result={rangeResult} onClear={clear} unit="currency" formatValue={fmt} valueLabel="Value" />
      </div>
    </div>
  );
}

const MiniStat = ({ label, value, color }: { label: React.ReactNode; value: string; color?: string }) => (
  <div className="rounded-md bg-muted/40 p-2">
    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>

    <p className={`text-xs font-semibold ${color || 'text-foreground'}`}>{value}</p>
  </div>
);
