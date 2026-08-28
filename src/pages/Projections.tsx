import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Play, TrendingDown, Shuffle, ArrowDownUp, Percent, Target, Flame, AlertTriangle } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, BarChart, Bar,
} from 'recharts';
import {
  projectXIRR, simulateCrash, runMonteCarlo, simulateSequenceRisk, simulateInflation,
  type ProjectionInputs, type XIRRProjectionResult, type CrashScenarioResult,
  type MonteCarloResult, type SequenceRiskResult, type InflationResult,
} from '@/lib/projectionEngine';
import { weightedAssumptions } from '@/lib/assetClassAssumptions';
import { GoalProjection } from '@/components/projections/GoalProjection';
import { FireModule } from '@/components/projections/FireModule';
import { StressReplay } from '@/components/projections/StressReplay';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';


function fmt(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtFull(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const StatCard = ({ label, value, sub, color }: { label: React.ReactNode; value: string; sub?: string; color?: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    <p className={`text-lg font-bold ${color || 'text-foreground'}`}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);


const DescriptionBox = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed space-y-1">
    {children}
  </div>
);

// ── XIRR Tab ──
const XIRRTab = ({ result, hidden, inputs }: { result: XIRRProjectionResult; hidden: boolean; inputs: ProjectionInputs }) => {
  const data = result.baseTimeline.map((pt, i) => ({
    year: `Y${pt.year}`, base: pt.value, conservative: result.conservativeTimeline[i]?.value ?? 0,
  }));
  return (
    <div className="space-y-4">
      <DescriptionBox>
        <p className="font-medium text-foreground text-sm mb-1">📈 XIRR-based projection</p>
        <p>Base = your portfolio's actual XIRR ({(result.baseXIRR * 100).toFixed(1)}%). Conservative = 20% lower to stress-test.</p>
      </DescriptionBox>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={<LabelWithHint label="Base XIRR" title="Base XIRR" side="top" caveat="Past XIRR is not a promise of future returns.">Your portfolio's realised money-weighted annual return, computed from actual transaction cash flows.</LabelWithHint>} value={`${(result.baseXIRR * 100).toFixed(1)}%`} color="text-green-500" />
        <StatCard label={<LabelWithHint label="Conservative XIRR" title="Conservative XIRR" side="top" formula="base XIRR × 0.8">A deliberately haircut return used as a downside sanity check against over-extrapolating a good run.</LabelWithHint>} value={`${(result.conservativeXIRR * 100).toFixed(1)}%`} color="text-yellow-500" />
        <StatCard label={<LabelWithHint label="Base Final" title="Base final corpus" side="top">Corpus at the end of the horizon if the base XIRR repeats every year and SIPs continue.</LabelWithHint>} value={hidden ? '••••' : fmt(result.baseFinalValue)} />
        <StatCard label={<LabelWithHint label="Conservative Final" title="Conservative final corpus" side="top">The same projection run at the haircut return — plan against this number, not the base one.</LabelWithHint>} value={hidden ? '••••' : fmt(result.conservativeFinalValue)} />

      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gBase" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(142,71%,45%)" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(142,71%,45%)" stopOpacity={0} /></linearGradient>
              <linearGradient id="gCons" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(45,93%,47%)" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(45,93%,47%)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={70} />
            <Tooltip formatter={(v: number) => hidden ? '••••' : fmtFull(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="base" name="Base XIRR" stroke="hsl(142,71%,45%)" fill="url(#gBase)" strokeWidth={2} />
            <Area type="monotone" dataKey="conservative" name="Conservative (−20%)" stroke="hsl(45,93%,47%)" fill="url(#gCons)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const CrashTab = ({ result, hidden }: { result: CrashScenarioResult; hidden: boolean }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
    {result.scenarios.map(s => (
      <div key={s.dropPct} className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" /><span className="font-bold text-foreground">−{s.dropPct}% Crash</span>
          <InfoHint title={`−${s.dropPct}% crash scenario`} side="top" formula={`corpus × (1 − ${s.dropPct / 100}) today, then compounded at the expected return + SIPs`}>An instant market fall of {s.dropPct}% applied to your starting corpus, after which contributions continue and the portfolio compounds at the expected return.</InfoHint>
        </div>
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground inline-flex items-center gap-1">Post-crash: <span className="text-foreground font-medium">{hidden ? '••••' : fmtFull(s.postCrashValue)}</span><InfoHint title="Post-crash value" side="right">What your corpus is worth the moment after the shock, before any recovery.</InfoHint></p>
          <p className="text-muted-foreground inline-flex items-center gap-1">Drawdown: <span className="text-red-500 font-medium">{hidden ? '••••' : fmtFull(s.drawdown)}</span><InfoHint title="Drawdown" side="right">Rupee value wiped out by the shock (starting corpus − post-crash value).</InfoHint></p>
          <p className="text-muted-foreground inline-flex items-center gap-1">Recovery: <span className="text-yellow-500 font-medium">{s.recoveryYears === Infinity ? 'N/A' : `${s.recoveryYears} yrs`}</span><InfoHint title="Recovery time" side="right">Years of compounding (plus SIPs) needed to climb back to the pre-crash corpus.</InfoHint></p>
          <p className="text-muted-foreground inline-flex items-center gap-1">Final: <span className="text-foreground font-medium">{hidden ? '••••' : fmtFull(s.finalValue)}</span><InfoHint title="End-of-horizon value" side="right">Corpus at the end of your chosen horizon despite the crash — useful next to the XIRR tab's no-crash number.</InfoHint></p>
        </div>

      </div>
    ))}
  </div>
);

const MonteCarloTab = ({ result, hidden }: { result: MonteCarloResult; hidden: boolean }) => {
  const tl = result.percentileTimelines.p50.map((pt, i) => ({
    year: `Y${pt.year}`, p10: result.percentileTimelines.p10[i]?.value ?? 0, p50: pt.value, p90: result.percentileTimelines.p90[i]?.value ?? 0,
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={<LabelWithHint label="Worst" title="Worst simulated path" side="top">The single lowest ending value out of 1,000 simulated paths — a tail case, not a floor.</LabelWithHint>} value={hidden ? '••••' : fmt(result.worst)} color="text-red-500" />
        <StatCard label={<LabelWithHint label="10th %ile" title="p10 outcome" side="top">90% of simulated paths ended above this value. Treat it as a pessimistic-but-plausible planning number.</LabelWithHint>} value={hidden ? '••••' : fmt(result.percentile10)} color="text-yellow-500" />
        <StatCard label={<LabelWithHint label="Median" title="p50 outcome" side="top">The middle path — half the simulations ended above, half below. The most representative single figure.</LabelWithHint>} value={hidden ? '••••' : fmt(result.median)} />
        <StatCard label={<LabelWithHint label="90th %ile" title="p90 outcome" side="top">Only 10% of paths beat this. The optimistic edge of the distribution.</LabelWithHint>} value={hidden ? '••••' : fmt(result.percentile90)} color="text-green-500" />
        <StatCard label={<LabelWithHint label="P(2x)" title="Probability of doubling" side="top" formula="share of the 1,000 paths ending ≥ 2 × initial corpus">How often the simulation at least doubles your starting corpus over the horizon.</LabelWithHint>} value={`${result.goalProbability}%`} color="text-blue-500" />

      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={tl}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={70} />
            <Tooltip formatter={(v: number) => hidden ? '••••' : fmtFull(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="p90" name="p90" stroke="hsl(142,71%,45%)" fill="none" strokeWidth={1.5} />
            <Area type="monotone" dataKey="p50" name="Median" stroke="hsl(220,70%,55%)" fill="none" strokeWidth={2} />
            <Area type="monotone" dataKey="p10" name="p10" stroke="hsl(0,72%,51%)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SequenceTab = ({ result, hidden }: { result: SequenceRiskResult; hidden: boolean }) => {
  const data = result.uniformTimeline.map((pt, i) => ({
    year: `Y${pt.year}`, uniform: pt.value, earlyBad: result.earlyBadTimeline[i]?.value ?? 0, lateBad: result.lateBadTimeline[i]?.value ?? 0,
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={<LabelWithHint label="Uniform" title="Uniform path" side="top">Every year earns exactly the expected return — the textbook straight-line case, used as the baseline.</LabelWithHint>} value={hidden ? '••••' : fmt(result.uniformFinal)} color="text-blue-500" />
        <StatCard label={<LabelWithHint label="Early Bad" title="Bad years first" side="top">Same set of yearly returns, but the negative years are front-loaded. Hurts most when you are withdrawing; helps SIP investors who keep buying cheap.</LabelWithHint>} value={hidden ? '••••' : fmt(result.earlyBadFinal)} color="text-yellow-500" />
        <StatCard label={<LabelWithHint label="Late Bad" title="Bad years last" side="top">Same returns with the bad years at the end, hitting the largest corpus. Usually the worst outcome for an accumulator.</LabelWithHint>} value={hidden ? '••••' : fmt(result.lateBadFinal)} color="text-red-500" />

      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={v => hidden ? '•••' : fmt(v)} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={70} />
            <Tooltip formatter={(v: number) => hidden ? '••••' : fmtFull(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="uniform" name="Uniform" stroke="hsl(220,70%,55%)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="earlyBad" name="Early Bad" stroke="hsl(45,93%,47%)" strokeWidth={2} dot={false} strokeDasharray="5 5" />
            <Line type="monotone" dataKey="lateBad" name="Late Bad" stroke="hsl(0,72%,51%)" strokeWidth={2} dot={false} strokeDasharray="5 5" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const InflationTab = ({ result, hidden }: { result: InflationResult; hidden: boolean }) => (
  <div className="space-y-4">
    {result.scenarios.map(s => (
      <div key={s.inflationPct} className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{s.inflationPct}% Inflation</h3>
          <span className="text-xs text-red-500 font-medium">−{s.purchasingPowerLoss}% purchasing power</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label={<LabelWithHint label="Nominal" title="Nominal value" side="top">The projected corpus in future rupees — the raw number the compounding produces.</LabelWithHint>} value={hidden ? '••••' : fmt(s.nominalFinal)} />
          <StatCard label={<LabelWithHint label="Real (today's ₹)" title="Real value" side="top" formula="real = nominal ÷ (1 + inflation)^years">The same corpus expressed in today's purchasing power. The gap versus nominal is what inflation quietly takes away.</LabelWithHint>} value={hidden ? '••••' : fmt(s.realFinal)} color="text-yellow-500" />

        </div>
      </div>
    ))}
  </div>
);

// ── Main Page ──
const ProjectionsContent = () => {
  const { hidden, toggle } = usePrivacy();
  const { summary, exposure, holdings, cash, currentPrices, loading } = usePortfolio();

  // Portfolio-weighted expected return & volatility from actual exposure
  const weighted = useMemo(() => {
    const totalCat = exposure.category.reduce((s, c) => s + c.value, 0);
    if (totalCat <= 0) return { expectedReturn: 0.12, volatility: 0.18 };
    return weightedAssumptions(
      exposure.category.map(c => ({ label: c.label, weight: c.value }))
    );
  }, [exposure.category]);

  const equityWeight = useMemo(() => {
    const total = exposure.category.reduce((s, c) => s + c.value, 0);
    if (total <= 0) return 0.7;
    const equityLabels = new Set(['Stocks', 'Equity', 'Mutual Funds', 'Index', 'ETF', 'US Stocks / ETFs', 'Crypto']);
    const eq = exposure.category.filter(c => equityLabels.has(c.label)).reduce((s, c) => s + c.value, 0);
    return eq / total;
  }, [exposure.category]);

  const [inputs, setInputs] = useState<ProjectionInputs>({
    initialInvestment: 0,
    monthlySIP: 5000,
    timeHorizonYears: 10,
    expectedReturnPct: 12,
    monthlyWithdrawal: 0,
  });
  const [hasRun, setHasRun] = useState(false);
  const [xirrResult, setXirrResult] = useState<XIRRProjectionResult | null>(null);
  const [crashResult, setCrashResult] = useState<CrashScenarioResult | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [seqResult, setSeqResult] = useState<SequenceRiskResult | null>(null);
  const [infResult, setInfResult] = useState<InflationResult | null>(null);

  // Prefill from portfolio and use weighted return once loaded
  useEffect(() => {
    if (!loading && summary.currentValue > 0) {
      setInputs(prev => ({
        ...prev,
        initialInvestment: prev.initialInvestment || Math.round(summary.currentValue),
        expectedReturnPct: prev.expectedReturnPct === 12 ? Math.round(weighted.expectedReturn * 100 * 10) / 10 : prev.expectedReturnPct,
      }));
    }
  }, [loading, summary.currentValue, weighted.expectedReturn]);

  // Goals + allocation-computed current values
  const [goals, setGoals] = useState<any[]>([]);
  const [goalAllocs, setGoalAllocs] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [g, a] = await Promise.all([
        supabase.from('goals').select('*'),
        supabase.from('goal_allocations').select('*'),
      ]);
      if (g.data) setGoals(g.data);
      if (a.data) setGoalAllocs(a.data);
    })();
  }, []);

  const goalCurrentValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const goal of goals) map[goal.id] = 0;
    for (const a of goalAllocs) {
      if (!map[a.goal_id] && map[a.goal_id] !== 0) continue;
      if (a.source_type === 'symbol' && a.symbol) {
        const qty = Number(a.quantity) || 0;
        const p = currentPrices[a.symbol] || 0;
        map[a.goal_id] += qty * p;
      } else {
        map[a.goal_id] += Number(a.amount) || 0;
      }
    }
    return map;
  }, [goals, goalAllocs, currentPrices]);

  const runAll = () => {
    const inp = { ...inputs, initialInvestment: inputs.initialInvestment || summary.currentValue };
    setXirrResult(projectXIRR(inp, summary.xirr));
    setCrashResult(simulateCrash(inp));
    setMcResult(runMonteCarlo(inp));
    setSeqResult(simulateSequenceRisk(inp));
    setInfResult(simulateInflation(inp));
    setHasRun(true);
  };

  const updateInput = (key: keyof ProjectionInputs, value: string) => {
    setInputs(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/overview" className="text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /></Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Projection Engine</h1>
              <p className="text-xs text-muted-foreground">Scenario simulations, goal probability, FIRE planning, and historical stress replay</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={toggle} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors">
              {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {hidden ? 'Show' : 'Hide'}
            </button>
          </div>
        </div>

        {/* Weighted assumptions strip */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5">
            Portfolio-weighted assumptions (from your current exposure):
            <InfoHint title="Where these come from" side="right" formula="Σ (category weight × asset-class assumption)" caveat="Volatility is a weighted average — correlations between asset classes are not modelled yet.">
              Every category in your exposure has a long-run return and volatility assumption; these are blended by the rupee weight of each category so the engine uses your actual asset mix rather than one generic number.
            </InfoHint>
          </div>
          <div className="flex gap-4 text-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">Expected return: <strong className="text-green-500">{(weighted.expectedReturn * 100).toFixed(1)}%</strong>
              <InfoHint title="Expected return" side="bottom">Blended long-run annual return of your current mix (e.g. equity 12%, debt 7%, gold 8%). Seeds the Expected Return input and the Goals/FIRE simulations.</InfoHint>
            </span>
            <span className="inline-flex items-center gap-1">Volatility: <strong className="text-yellow-500">{(weighted.volatility * 100).toFixed(1)}%</strong>
              <InfoHint title="Volatility" side="bottom">Annualised standard deviation of the blended mix. It sets how wide the Monte Carlo fan spreads — higher vol means a wider gap between p10 and p90.</InfoHint>
            </span>
            <span className="inline-flex items-center gap-1">Equity weight: <strong className="text-blue-500">{(equityWeight * 100).toFixed(0)}%</strong>
              <InfoHint title="Equity weight" side="bottom">Share of your portfolio in Stocks, Equity, Mutual Funds, Index, ETF, US Stocks/ETFs and Crypto. Used as the default shock exposure in the Stress Lab.</InfoHint>
            </span>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="w-full flex overflow-x-auto">
            <TabsTrigger value="overview" className="flex-1 text-xs gap-1"><Play className="w-3 h-3" /> Overview<InfoHint title="Overview" side="bottom">A what-if sandbox: enter a corpus, SIP and horizon, then run five independent scenarios (XIRR, crash, Monte Carlo, sequence risk, inflation) on those inputs.</InfoHint></TabsTrigger>
            <TabsTrigger value="goals" className="flex-1 text-xs gap-1"><Target className="w-3 h-3" /> Goals<InfoHint title="Goals" side="bottom">Runs a Monte Carlo on one saved goal using the money actually allocated to it, and answers: what is the probability of hitting the target by its date, and what SIP would be required?</InfoHint></TabsTrigger>
            <TabsTrigger value="fire" className="flex-1 text-xs gap-1"><Flame className="w-3 h-3" /> FIRE<InfoHint title="FIRE" side="bottom">Two-phase retirement simulation: accumulate with SIPs until your retirement age, then withdraw inflation-adjusted expenses until life expectancy, reporting corpus gap and survival probability.</InfoHint></TabsTrigger>
            <TabsTrigger value="stress" className="flex-1 text-xs gap-1"><AlertTriangle className="w-3 h-3" /> Stress Lab<InfoHint title="Stress Lab" side="bottom">Replays real crisis windows (2008 GFC, 2020 COVID, 2000 dot-com) on your current AUM at your equity weight, showing drawdown, trough and recovery time.</InfoHint></TabsTrigger>
          </TabsList>


          <TabsContent value="overview" className="space-y-4">
            {/* Input Panel */}
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-1.5">
                Simulation Inputs
                <InfoHint title="Simulation inputs" side="right" caveat="Nothing here is saved — changing inputs only affects this page.">
                  The five assumptions every Overview scenario below is built from. Initial and Expected Return are pre-filled from your live AUM and your exposure-weighted return; override any of them and press Run.
                </InfoHint>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Initial (₹)" title="Initial corpus" side="top">Starting value of the simulation. Pre-filled with your current portfolio market value.</LabelWithHint></Label><Input type="number" value={inputs.initialInvestment || ''} onChange={e => updateInput('initialInvestment', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Monthly SIP (₹)" title="Monthly contribution" side="top">Amount added at the start of every month for the whole horizon. Not read from your transactions — set it yourself.</LabelWithHint></Label><Input type="number" value={inputs.monthlySIP || ''} onChange={e => updateInput('monthlySIP', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Horizon (Yrs)" title="Time horizon" side="top">Number of years each scenario is projected forward. Charts plot one point per year.</LabelWithHint></Label><Input type="number" value={inputs.timeHorizonYears || ''} onChange={e => updateInput('timeHorizonYears', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Expected Return (%)" title="Expected annual return" side="top" caveat="An assumption, not a forecast.">Pre-filled from the exposure-weighted asset-class return shown in the strip above. Used by Crash, Monte Carlo, Sequence and Inflation.</LabelWithHint></Label><Input type="number" value={inputs.expectedReturnPct || ''} onChange={e => updateInput('expectedReturnPct', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground"><LabelWithHint label="Monthly Withdrawal (₹)" title="Monthly withdrawal" side="top">Cash taken out each month. Leave at 0 while accumulating; set it to model a drawdown and to make sequence risk bite.</LabelWithHint></Label><Input type="number" value={inputs.monthlyWithdrawal || ''} onChange={e => updateInput('monthlyWithdrawal', e.target.value)} className="mt-1 h-8 text-sm" /></div>

              </div>
              <button onClick={runAll} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Play className="w-4 h-4" /> Run All Simulations
              </button>
            </div>

            {hasRun && (
              <Tabs defaultValue="xirr" className="space-y-4">
                <TabsList className="w-full flex overflow-x-auto">
                  <TabsTrigger value="xirr" className="flex-1 text-xs gap-1"><Play className="w-3 h-3" /> XIRR<InfoHint title="XIRR projection" formula="FV = compound(initial + monthly SIP) @ XIRR; conservative = XIRR × 0.8">Grows your current corpus and SIP forward at the money-weighted return your portfolio has actually earned, plus a −20% stress line.</InfoHint></TabsTrigger>
                  <TabsTrigger value="crash" className="flex-1 text-xs gap-1"><TrendingDown className="w-3 h-3" /> Crash<InfoHint title="Crash scenarios" formula="drops of −20% / −35% / −50% applied today, then recovery at expected return">Applies an instant market shock to today's corpus and shows the drawdown, years to get back to the pre-crash level, and end-of-horizon value.</InfoHint></TabsTrigger>
                  <TabsTrigger value="montecarlo" className="flex-1 text-xs gap-1"><Shuffle className="w-3 h-3" /> Monte Carlo<InfoHint title="Monte Carlo" formula="1,000 random return paths ~ N(expected return, volatility)">Instead of one straight-line return, it simulates 1,000 possible futures and reports the spread — worst, p10, median, p90 — plus the chance of doubling.</InfoHint></TabsTrigger>
                  <TabsTrigger value="sequence" className="flex-1 text-xs gap-1"><ArrowDownUp className="w-3 h-3" /> Sequence<InfoHint title="Sequence-of-returns risk" caveat="Same average return in all three paths — only the order changes.">Shows that *when* bad years arrive matters. Identical average returns are re-ordered so the bad years hit early vs late; with SIPs or withdrawals the end value differs.</InfoHint></TabsTrigger>
                  <TabsTrigger value="inflation" className="flex-1 text-xs gap-1"><Percent className="w-3 h-3" /> Inflation<InfoHint title="Inflation impact" formula="real = nominal ÷ (1 + i)^years, for i = 5% / 7% / 9%">Restates the projected corpus in today's rupees so you can see how much purchasing power the headline number loses.</InfoHint></TabsTrigger>

                </TabsList>
                <TabsContent value="xirr">{xirrResult && <XIRRTab result={xirrResult} hidden={hidden} inputs={inputs} />}</TabsContent>
                <TabsContent value="crash">{crashResult && <CrashTab result={crashResult} hidden={hidden} />}</TabsContent>
                <TabsContent value="montecarlo">{mcResult && <MonteCarloTab result={mcResult} hidden={hidden} />}</TabsContent>
                <TabsContent value="sequence">{seqResult && <SequenceTab result={seqResult} hidden={hidden} />}</TabsContent>
                <TabsContent value="inflation">{infResult && <InflationTab result={infResult} hidden={hidden} />}</TabsContent>
              </Tabs>
            )}
          </TabsContent>

          <TabsContent value="goals">
            <GoalProjection
              goals={goals}
              goalCurrentValues={goalCurrentValues}
              expectedReturn={weighted.expectedReturn}
              volatility={weighted.volatility}
              hidden={hidden}
            />
          </TabsContent>

          <TabsContent value="fire">
            <FireModule
              currentCorpus={summary.totalPortfolioValue}
              expectedReturn={weighted.expectedReturn}
              volatility={weighted.volatility}
              hidden={hidden}
            />
          </TabsContent>

          <TabsContent value="stress">
            <StressReplay
              currentAUM={summary.totalPortfolioValue}
              equityWeight={equityWeight}
              hidden={hidden}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

const Projections = () => (
  <PrivacyProvider>
    <ProjectionsContent />
  </PrivacyProvider>
);

export default Projections;
