import { SignalResult } from '@/lib/deploymentSignal';
import { TrendingUp, TrendingDown, Minus, ShieldCheck, AlertCircle } from 'lucide-react';
import { InfoHint } from '@/components/InfoHint';

interface Props {
  signal: SignalResult;
}

/** Purpose of each factor — why it is in the model at all. */
const FACTOR_HELP: Record<string, { title: string; body: string; formula?: string }> = {
  sectorPE: {
    title: 'PE vs sector median',
    body: 'A PE is only cheap or dear relative to its peer group. This compares the trailing PE against the median PE for the stock\u2019s sector, so a 45x software name is not punished for not looking like a bank.',
    formula: 'points = clamp((sectorMedian − PE) ÷ sectorMedian ÷ 0.30, −1, 1) × 28',
  },
  growth: {
    title: 'Forward vs trailing PE',
    body: 'Forward PE below trailing PE means analysts expect earnings to grow — the same price buys more future profit. A forward PE above trailing signals expected earnings decline.',
  },
  '52w': {
    title: 'Price vs 52-week range',
    body: 'Where the price sits between its 52-week low and high. Near the low scores positively (mean-reversion / margin of safety), near the high scores negatively.',
  },
  erp: {
    title: 'Earnings yield vs 10Y G-Sec',
    body: 'Equity risk premium: the inverse of PE (earnings yield) minus the risk-free Indian 10-year government bond yield. If a stock yields less than a G-Sec, you are taking equity risk for no compensation.',
    formula: 'ERP = (1 ÷ PE) − 10Y G-Sec yield',
  },
  div: {
    title: 'Dividend yield',
    body: 'Cash actually returned to shareholders, benchmarked against the ~1.5% broad-market average. A small weight — it is a supporting signal, not a thesis.',
  },
  regime: {
    title: 'Market regime (NIFTY CAPE)',
    body: 'Overlays the broad-market Shiller PE from the strip at the top. Even a cheap stock deserves less conviction in a bubble market, and vice versa.',
  },
};

export function SignalDecomposition({ signal }: Props) {
  const maxAbs = Math.max(...signal.factors.map(f => Math.abs(f.points)), 1);
  const lowConfidence = signal.confidence < 0.6;
  const missing = signal.factors.filter(f => !f.available).length;


  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header — verdict + score gauge */}
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            Signal Decomposition · {signal.sector}
            <InfoHint title="Signal decomposition" side="bottom" formula="score = Σ (factor points), factor weights sum to 100" caveat="A valuation screen, not investment advice. It says nothing about business quality, debt or management.">
              Instead of a single PE verdict, six independent factors each contribute a signed number of points to one score. The bars below show exactly how much each factor pushed the verdict up or down, so you can disagree with any one input.
            </InfoHint>
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2.5 py-1 rounded-md border text-sm font-bold ${signal.verdictColor}`}>
              {signal.verdict}
            </span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              Score {signal.score >= 0 ? '+' : ''}{signal.score.toFixed(0)} / 100
              <InfoHint title="Score to verdict" side="bottom" formula="≥ +40 Strong Buy · ≥ +15 Buy · −15 to +15 Hold · ≤ −15 Avoid · ≤ −40 Strong Avoid">The sum of all six factor contributions, mapped to a verdict band. A score near zero means the factors cancel out — genuinely no edge either way.</InfoHint>
            </span>
          </div>

        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {lowConfidence ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/30">
              <AlertCircle className="w-3 h-3" />
              Low confidence — {missing} of {signal.factors.length} inputs missing
              <InfoHint title="Confidence" side="bottom">Share of total factor weight backed by real data. Missing inputs (no forward PE, no dividend, no CAPE) contribute zero points and drag confidence down. Below 60% the verdict is thin — treat it as directional only.</InfoHint>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" />
              Confidence {(signal.confidence * 100).toFixed(0)}%
              <InfoHint title="Confidence" side="bottom" formula="available factor weight ÷ total weight">Share of total factor weight backed by real fetched data rather than missing inputs. 100% means every one of the six factors had live data.</InfoHint>
            </span>
          )}
        </div>

      </div>

      {/* Score bar */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
          {signal.score >= 0 ? (
            <div
              className="absolute inset-y-0 left-1/2 bg-emerald-500/70 rounded-r-full"
              style={{ width: `${Math.min(50, (signal.score / 100) * 50)}%` }}
            />
          ) : (
            <div
              className="absolute inset-y-0 bg-red-500/70 rounded-l-full"
              style={{
                right: '50%',
                width: `${Math.min(50, (Math.abs(signal.score) / 100) * 50)}%`,
              }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
          <span>−100 Avoid</span>
          <span>0</span>
          <span>+100 Buy</span>
        </div>
      </div>

      {/* Factors */}
      <div className="divide-y divide-border">
        {signal.factors.map(f => {
          const barWidth = (Math.abs(f.points) / maxAbs) * 50;
          const posColor = f.direction === 'positive' ? 'bg-emerald-500/70' : f.direction === 'negative' ? 'bg-red-500/70' : 'bg-muted-foreground/30';
          const Icon = f.direction === 'positive' ? TrendingUp : f.direction === 'negative' ? TrendingDown : Minus;
          const iconColor = f.direction === 'positive' ? 'text-emerald-500' : f.direction === 'negative' ? 'text-red-500' : 'text-muted-foreground';

          return (
            <div key={f.key} className={`px-4 py-3 ${!f.available ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
                  <span className="text-sm font-medium text-foreground truncate">{f.name}</span>
                  {FACTOR_HELP[f.key] && (
                    <InfoHint
                      title={FACTOR_HELP[f.key].title}
                      formula={FACTOR_HELP[f.key].formula}
                      side="top"
                      caveat={!f.available ? 'Input unavailable for this ticker — this factor contributes 0 and lowers overall confidence.' : undefined}
                      className="shrink-0"
                    >
                      {FACTOR_HELP[f.key].body}
                    </InfoHint>
                  )}
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 inline-flex items-center gap-1">
                    w={(f.weight * 100).toFixed(0)}%
                    <InfoHint title="Factor weight" side="top">Maximum share of the ±100 score this factor can move. A fully bullish reading here is worth ±{(f.weight * 100).toFixed(0)} points.</InfoHint>
                  </span>
                </div>

                <span className={`text-sm font-mono font-semibold shrink-0 ${f.direction === 'positive' ? 'text-emerald-500' : f.direction === 'negative' ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {f.points >= 0 ? '+' : ''}{f.points.toFixed(1)}
                </span>
              </div>

              {/* Contribution bar */}
              <div className="relative h-1.5 bg-muted/50 rounded-full overflow-hidden mb-1.5">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                {f.points >= 0 ? (
                  <div className={`absolute inset-y-0 left-1/2 ${posColor} rounded-r-full`} style={{ width: `${barWidth}%` }} />
                ) : (
                  <div className={`absolute inset-y-0 ${posColor} rounded-l-full`} style={{ right: '50%', width: `${barWidth}%` }} />
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>value: <span className="text-foreground">{f.value}</span></span>
                <span>benchmark: <span className="text-foreground">{f.benchmark}</span></span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 italic">{f.note}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
