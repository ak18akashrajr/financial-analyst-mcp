import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine } from 'recharts';
import { Flame } from 'lucide-react';
import { simulateFire } from '@/lib/monteCarloAdvanced';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';


function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function FireModule({
  currentCorpus,
  expectedReturn,
  volatility,
  hidden,
}: {
  currentCorpus: number;
  expectedReturn: number;
  volatility: number;
  hidden: boolean;
}) {
  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(50);
  const [lifeExpectancy, setLifeExpectancy] = useState(85);
  const [monthlyExpenseToday, setMonthlyExpenseToday] = useState(60000);
  const [inflation, setInflation] = useState(6);
  const [postRetReturn, setPostRetReturn] = useState(8);
  const [monthlySIP, setMonthlySIP] = useState(30000);
  const [swrPct, setSwrPct] = useState(4);

  const result = useMemo(() => simulateFire({
    currentCorpus,
    currentAge,
    retirementAge,
    lifeExpectancy,
    monthlyExpenseToday,
    inflation: inflation / 100,
    expectedReturn,
    postRetReturn: postRetReturn / 100,
    volatility,
    monthlySIP,
    swrPct: swrPct / 100,
  }, 500), [currentCorpus, currentAge, retirementAge, lifeExpectancy, monthlyExpenseToday, inflation, expectedReturn, postRetReturn, volatility, monthlySIP, swrPct]);

  const combinedTL = [...result.accumTimeline, ...result.drawdownTimeline.slice(1)];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground text-sm mb-1 flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> FIRE / Retirement Simulation</p>
        <p>Two-phase Monte Carlo (500 sims): <strong>Accumulation</strong> (SIP in until retirement) → <strong>Drawdown</strong> (inflation-adjusted withdrawals until life expectancy). Portfolio-weighted vol from your actual exposure. Required corpus uses your Safe Withdrawal Rate assumption.</p>
      </div>

      {/* Inputs */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumInput label="Current age" value={currentAge} onChange={setCurrentAge} hint={{ title: 'Current age', body: 'Start of the accumulation phase — the left edge of the chart below.' }} />
          <NumInput label="Retirement age" value={retirementAge} onChange={setRetirementAge} hint={{ title: 'Retirement age', body: 'Age at which SIPs stop and withdrawals begin. Marked by the dashed "Retire" line on the chart.' }} />
          <NumInput label="Life expectancy" value={lifeExpectancy} onChange={setLifeExpectancy} hint={{ title: 'Life expectancy', body: 'How long the corpus must last. Survival probability is measured against reaching this age with money left.' }} />
          <NumInput label="Monthly spend today (₹)" value={monthlyExpenseToday} onChange={setMonthlyExpenseToday} hint={{ title: 'Monthly spend (today)', body: 'Your current cost of living. It is inflated forward to your retirement year, so enter it in today\u2019s rupees.' }} />
          <NumInput label="Inflation %" value={inflation} onChange={setInflation} step={0.5} hint={{ title: 'Inflation', body: 'Annual rate used to grow expenses both before and during retirement. Indian retail inflation has historically run around 5–6%.' }} />
          <NumInput label="Post-ret return %" value={postRetReturn} onChange={setPostRetReturn} step={0.5} hint={{ title: 'Post-retirement return', body: 'Expected return once you shift to a more conservative mix after retiring. Usually lower than the accumulation-phase return.' }} />
          <NumInput label="Monthly SIP (₹)" value={monthlySIP} onChange={setMonthlySIP} hint={{ title: 'Monthly SIP', body: 'Amount invested every month until retirement. Raise it to close the gap shown in the stats below.' }} />
          <NumInput label="SWR %" value={swrPct} onChange={setSwrPct} step={0.25} hint={{ title: 'Safe Withdrawal Rate', body: 'Percentage of the corpus you plan to withdraw in year one. It sets the required corpus: annual expense ÷ SWR. The classic 4% rule is a US study; 3–3.5% is often suggested for India.' }} />
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={<LabelWithHint label="Required corpus @ retirement" title="Required corpus" side="top" formula="inflated annual expense at retirement ÷ SWR">The nest egg needed on day one of retirement to fund your inflated living costs at the chosen safe withdrawal rate.</LabelWithHint>} value={hidden ? '••••' : fmt(result.requiredCorpusAtRetirement)} />
        <Stat label={<LabelWithHint label="Projected p50 corpus" title="Projected median corpus" side="top">The median result of 500 simulated accumulation paths at your retirement age. Green means it clears the required corpus.</LabelWithHint>} value={hidden ? '••••' : fmt(result.projectedCorpusAtRetirement.p50)} color={result.projectedCorpusAtRetirement.p50 >= result.requiredCorpusAtRetirement ? 'text-green-500' : 'text-red-500'} />
        <Stat label={<LabelWithHint label="Gap (add'l SIP needed)" title="Funding gap" side="top">Extra monthly investment required, on top of your current SIP, for the median path to reach the required corpus. "On track" means no additional SIP is needed.</LabelWithHint>} value={hidden ? '••••' : (result.requiredAdditionalSIP > 0 ? `${fmt(result.requiredAdditionalSIP)}/mo` : 'On track ✓')} color={result.requiredAdditionalSIP > 0 ? 'text-yellow-500' : 'text-green-500'} />
        <Stat label={<LabelWithHint label="Portfolio survival prob" title="Survival probability" side="top" formula="share of 500 paths with corpus > 0 at life expectancy">How often the corpus outlives you across the simulated drawdown paths. Below ~85% means the plan is fragile. FIRE age is the earliest age the median path can sustain withdrawals.</LabelWithHint>} value={`${(result.survivalProbability * 100).toFixed(0)}%`} color={result.survivalProbability >= 0.85 ? 'text-green-500' : result.survivalProbability >= 0.6 ? 'text-yellow-500' : 'text-red-500'} sub={result.fireAge ? `FIRE age: ~${Math.round(result.fireAge)}` : 'No FIRE age reached'} />
      </div>


      {/* Chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Corpus by age — accumulation → drawdown (p10/p50/p90)</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={combinedTL}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={70} />
            <Tooltip formatter={(v: number) => hidden ? '••••' : fmt(v)} labelFormatter={(l) => `Age ${l}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine x={retirementAge} stroke="hsl(45,93%,47%)" strokeDasharray="4 4" label={{ value: 'Retire', position: 'top', fill: 'hsl(45,93%,47%)', fontSize: 10 }} />
            <ReferenceLine y={result.requiredCorpusAtRetirement} stroke="hsl(0,72%,51%)" strokeDasharray="2 2" label={{ value: 'Required', position: 'right', fill: 'hsl(0,72%,51%)', fontSize: 10 }} />
            <Line type="monotone" dataKey="p90" name="p90" stroke="hsl(142,71%,45%)" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="p50" name="Median" stroke="hsl(220,70%,55%)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="p10" name="p10" stroke="hsl(0,72%,51%)" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const NumInput = ({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (n: number) => void; step?: number; hint?: { title: string; body: React.ReactNode } }) => (
  <div>
    <label className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      {label}
      {hint && <InfoHint title={hint.title} side="top">{hint.body}</InfoHint>}
    </label>
    <input
      type="number"
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className="w-full mt-1 h-9 px-3 text-sm rounded-md border border-border bg-background"
    />
  </div>
);

const Stat = ({ label, value, color, sub }: { label: React.ReactNode; value: string; color?: string; sub?: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    <p className={`text-base font-bold ${color || 'text-foreground'}`}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

