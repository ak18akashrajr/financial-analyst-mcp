import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Gauge, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';
import {
  computeRiskMetrics,
  dailyReturnsFromCloses,
  RISK_FREE_RATE,
  type PortfolioRiskMetrics,
} from '@/lib/riskMetrics';

// Fixed to match get_risk_metrics' own default lookbackDays exactly (see
// supabase/functions/_shared/portfolio-data.ts) — this page's numbers should always agree with
// what the portfolio AI reports for the same question, with no window parameter to drift out of
// sync. If get_risk_metrics' default ever changes, update this constant to match.
const LOOKBACK_DAYS = 90;

interface PriceRow {
  symbol: string;
  date: string;
  close: number;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtRatio(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

function fmtRupeeRatio(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `₹${n.toFixed(2)}`;
}

const RiskMetricsContent = () => {
  const { hidden, toggle, mask } = usePrivacy();
  const { holdings, loading: portfolioLoading } = usePortfolio();

  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [benchRows, setBenchRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);

  // Only holdings with a live price contribute a return series — a holding with no current price
  // has no meaningful currentValue to weight it by, same exclusion convention get_risk_metrics
  // uses server-side (see missingPriceSymbols in supabase/functions/_shared/portfolio-data.ts).
  const riskHoldings = useMemo(() => holdings.filter(h => h.currentPrice > 0), [holdings]);
  const missingPriceSymbols = useMemo(
    () => holdings.filter(h => h.currentPrice <= 0).map(h => h.symbol),
    [holdings],
  );
  const symbols = useMemo(() => riskHoldings.map(h => h.symbol).sort(), [riskHoldings]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (symbols.length === 0) {
        setPriceRows([]);
        setLoading(false);
        return;
      }
      // Ordered newest-first with no row-count limit, then grouped and sliced to the most recent
      // LOOKBACK_DAYS+1 per symbol below — the same shape fetchDailyReturnsBySymbol uses
      // server-side (a single `.in()` query can't express "most recent N rows per symbol" itself).
      const { data, error } = await supabase
        .from('historical_prices')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .order('date', { ascending: false });
      if (error) toast.error(`Failed to load historical prices: ${error.message}`);
      setPriceRows((data ?? []).map(r => ({ symbol: r.symbol, date: r.date, close: Number(r.close) })));
      setLoading(false);
    })();
  }, [symbols]);

  const loadBenchmark = async () => {
    // benchmark_history isn't in the generated Supabase types (same codegen-drift note as
    // src/pages/Benchmark.tsx), hence the `as any` cast.
    const { data, error } = await supabase
      .from('benchmark_history' as any)
      .select('date, close')
      .eq('symbol', 'NIFTY50')
      .order('date', { ascending: false })
      .limit(LOOKBACK_DAYS + 1);
    if (error) { toast.error(`Failed to load NIFTY 50 data: ${error.message}`); return; }
    setBenchRows((((data as unknown as { date: string; close: number }[]) ?? [])).map(r => ({ symbol: 'NIFTY50', date: r.date, close: Number(r.close) })));
  };

  useEffect(() => {
    loadBenchmark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backfillBenchmark = async () => {
    setBackfilling(true);
    const t = toast.loading('Backfilling NIFTY 50 data…');
    try {
      const { data, error } = await supabase.functions.invoke('fetch-benchmark-prices', {
        body: { symbols: ['NIFTY50'], range: '2y', interval: '1d' },
      });
      if (error) throw error;
      const failed = Object.entries(data?.benchmarks ?? {}).filter(([, v]: [string, any]) => v?.error);
      if (failed.length > 0) throw new Error(failed.map(([sym, v]: [string, any]) => `${sym}: ${v.error}`).join('; '));
      await loadBenchmark();
      toast.success('Backfilled NIFTY 50 data', { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfilling(false);
    }
  };

  const metrics: PortfolioRiskMetrics = useMemo(() => {
    const bySymbol: Record<string, { date: string; close: number }[]> = {};
    for (const r of priceRows) (bySymbol[r.symbol] ||= []).push(r);

    const returnsBySymbol: Record<string, number[]> = {};
    for (const symbol of symbols) {
      const closes = (bySymbol[symbol] || [])
        .slice(0, LOOKBACK_DAYS + 1) // most recent N+1 (rows are newest-first)
        .map(r => r.close)
        .reverse(); // ascending, so dailyReturnsFromCloses reads oldest -> newest
      returnsBySymbol[symbol] = dailyReturnsFromCloses(closes);
    }

    const benchCloses = [...benchRows].reverse().map(r => r.close);
    const benchReturns = dailyReturnsFromCloses(benchCloses);

    return computeRiskMetrics(
      riskHoldings.map(h => ({ symbol: h.symbol, currentValue: h.currentValue })),
      returnsBySymbol,
      benchReturns,
    );
  }, [priceRows, benchRows, riskHoldings, symbols]);

  const totalValue = riskHoldings.reduce((s, h) => s + h.currentValue, 0);
  const isLoading = portfolioLoading || loading;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to="/overview" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></Link>
            <div>
              <div className="text-xl font-bold text-foreground flex items-center gap-2">
                <h1 className="flex items-center gap-2"><Gauge className="w-5 h-5" /> Risk Metrics</h1>
                <InfoHint
                  title="Risk Metrics"
                  side="right"
                  caveat="The Alpha shown here is Jensen's Alpha (CAPM) — a different metric from the 'Realized & Unrealized Alpha' or 'Alpha (USD)' shown on the dashboard/USD View, both of which are just plain P&L under the same name. Don't compare the two directly."
                >
                  Volatility, Beta, Alpha and Sharpe Ratio — the standard "risk ratios" for judging how much risk your
                  portfolio is taking and whether it's being paid for that risk, estimated from the last {LOOKBACK_DAYS}{' '}
                  trading days of historical prices. Matches what the portfolio AI's get_risk_metrics tool reports for
                  the same question.
                </InfoHint>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <span>Trailing {LOOKBACK_DAYS} trading days · vs. NIFTY 50 · risk-free rate {RISK_FREE_RATE * 100}% (10Y India G-Sec)</span>
                <InfoHint title="Risk-free rate" side="bottom">
                  Alpha and Sharpe Ratio both need a "no-risk" baseline return to compare against. This app uses the
                  10Y India G-Sec yield, the same assumption already used elsewhere (e.g. the Deploy page's equity
                  risk premium calc) — editable in src/lib/sectorBenchmarks.ts.
                </InfoHint>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={toggle} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground">
              {hidden ? 'Show' : 'Hide'} numbers
            </button>
            <button onClick={backfillBenchmark} disabled={backfilling} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> {backfilling ? 'Backfilling…' : 'Backfill NIFTY 50 data'}
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : riskHoldings.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">No holdings with a live price yet — nothing to compute risk metrics from.</p>
          </div>
        ) : (
          <>
            {missingPriceSymbols.length > 0 && (
              <p className="text-xs text-amber-500">
                ⚠ Excluded from every figure below (no current price): {missingPriceSymbols.join(', ')}.
              </p>
            )}
            {!metrics.benchmarkDataAvailable && (
              <p className="text-xs text-muted-foreground">
                No NIFTY 50 benchmark data yet — Beta, Alpha and Sharpe Ratio need it. Click "Backfill NIFTY 50 data" above, then come back. Volatility and Return don't need a benchmark and are shown regardless.
              </p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat
                label={
                  <LabelWithHint label="Volatility" title="Annualized Volatility" side="top" formula="stdev(daily returns) × √252 × 100">
                    How much your portfolio's value swings day to day, scaled up to a yearly figure. Higher means a
                    bumpier ride — for the same expected return, lower volatility is generally better.
                  </LabelWithHint>
                }
                value={mask(fmtPct(metrics.portfolioAnnualizedVolatilityPercent))}
              />
              <Stat
                label={
                  <LabelWithHint label="Beta" title="Beta vs. NIFTY 50" side="top" formula="cov(returns, benchmark returns) ÷ var(benchmark returns)">
                    How sensitive your portfolio is to NIFTY 50's moves. 1.0 means it moves in lockstep; above 1
                    amplifies the index's moves (in both directions), below 1 dampens them.
                  </LabelWithHint>
                }
                value={mask(fmtRatio(metrics.portfolioBetaVsNifty50))}
              />
              <Stat
                label={
                  <LabelWithHint
                    label="Alpha"
                    title="Jensen's Alpha (CAPM)"
                    side="top"
                    formula="Return − [risk-free + β × (benchmark return − risk-free)]"
                    caveat="Different metric from the dashboard's 'Realized & Unrealized Alpha' — that one is just P&L under the same name."
                  >
                    Return earned above what CAPM predicts is "fair" for the risk (beta) taken. Positive means you
                    beat the risk-adjusted expectation; negative means you underperformed it.
                  </LabelWithHint>
                }
                value={mask(fmtPct(metrics.portfolioAlphaPercent))}
                positive={metrics.portfolioAlphaPercent === null ? undefined : metrics.portfolioAlphaPercent >= 0}
              />
              <Stat
                label={
                  <LabelWithHint label="Sharpe Ratio" title="Sharpe Ratio" side="top" formula="(Return − risk-free) ÷ Volatility" caveat="Null (not shown as 0) for a holding/portfolio with zero volatility — the ratio is undefined, not infinite, in that case.">
                    Excess return earned per unit of volatility taken. Higher is better — it answers "was the risk
                    worth it," not just "did it go up."
                  </LabelWithHint>
                }
                value={mask(fmtRatio(metrics.portfolioSharpeRatio))}
                positive={metrics.portfolioSharpeRatio === null ? undefined : metrics.portfolioSharpeRatio >= 0}
              />
              <Stat
                label={
                  <LabelWithHint
                    label="Risk per ₹1 Return"
                    title="Risk per ₹1 of Return"
                    side="top"
                    formula="Volatility ÷ Annualized Return"
                    caveat="Shown as — when the annualized return is zero or negative — the ratio isn't meaningful without real profit to divide the risk by."
                  >
                    A plain "unit economics" read on the same two numbers above: for every ₹1 of annualized return
                    you're earning, how many ₹ of volatility (risk) you're carrying to get it. Lower is better — it's
                    cheaper risk per rupee of profit.
                  </LabelWithHint>
                }
                value={mask(fmtRupeeRatio(metrics.portfolioRiskPerRupeeOfReturn))}
              />
            </div>

            {/* Per-holding table */}
            <div className="rounded-lg border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b border-border">
                  <tr className="text-left">
                    <th className="font-medium px-4 py-2">Symbol</th>
                    <th className="font-medium px-4 py-2">Weight</th>
                    <th className="font-medium px-4 py-2">Ann. Return</th>
                    <th className="font-medium px-4 py-2">Volatility</th>
                    <th className="font-medium px-4 py-2">Beta</th>
                    <th className="font-medium px-4 py-2">Alpha</th>
                    <th className="font-medium px-4 py-2">Sharpe</th>
                    <th className="font-medium px-4 py-2">
                      <LabelWithHint label="Risk/₹1 Return" title="Risk per ₹1 of Return" side="top" formula="Volatility ÷ Ann. Return" caveat="— when return is zero or negative.">
                        ₹ of volatility carried per ₹1 of this holding's own annualized return.
                      </LabelWithHint>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.perHolding.map(h => {
                    const weightPercent = totalValue > 0
                      ? ((riskHoldings.find(r => r.symbol === h.symbol)?.currentValue ?? 0) / totalValue) * 100
                      : 0;
                    return (
                      <tr key={h.symbol} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-medium text-foreground">{h.symbol}</td>
                        <td className="px-4 py-2 font-mono">{weightPercent.toFixed(1)}%</td>
                        <td className="px-4 py-2 font-mono">{mask(fmtPct(h.annualizedReturnPercent))}</td>
                        <td className="px-4 py-2 font-mono">{mask(fmtPct(h.annualizedVolatilityPercent))}</td>
                        <td className="px-4 py-2 font-mono">{fmtRatio(h.beta)}</td>
                        <td className="px-4 py-2 font-mono">{mask(fmtPct(h.alpha))}</td>
                        <td className="px-4 py-2 font-mono">{fmtRatio(h.sharpeRatio)}</td>
                        <td className="px-4 py-2 font-mono">{mask(fmtRupeeRatio(h.riskPerRupeeOfReturn))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              All figures are estimated from the last {LOOKBACK_DAYS} trading days of{' '}
              <code>historical_prices</code>/<code>benchmark_history</code> rows, weighted by each holding's current
              market value — a holding with fewer than 2 days of history, or no current price, is left out of the
              weighted portfolio-level figures entirely rather than assumed to be zero. Matches the{' '}
              <code>get_risk_metrics</code> MCP tool's methodology exactly, so this page and the portfolio AI always
              agree for the same question.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, positive }: { label: ReactNode; value: string; positive?: boolean }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <p className={`text-lg font-bold mt-1 font-mono ${positive === true ? 'text-green-600' : positive === false ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
  </div>
);

const RiskMetrics = () => (
  <PrivacyProvider>
    <RiskMetricsContent />
  </PrivacyProvider>
);
export default RiskMetrics;
