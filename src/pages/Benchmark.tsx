import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';

// Mirrors BENCHMARK_TICKERS in supabase/functions/fetch-benchmark-prices/index.ts — the friendly
// symbols benchmark_history is keyed by (not the underlying Yahoo tickers).
const BENCHMARK_OPTIONS = [
  { symbol: 'NIFTY50', label: 'NIFTY 50' },
  { symbol: 'NIFTY500', label: 'NIFTY 500' },
  { symbol: 'SPX', label: 'S&P 500' },
] as const;
type BenchmarkSymbol = (typeof BENCHMARK_OPTIONS)[number]['symbol'];

// Matches the `days` parameter the compare_to_benchmark MCP tool accepts (default 90) — see
// compareToBenchmark in supabase/functions/_shared/portfolio-data.ts.
const WINDOW_OPTIONS = [30, 90, 180, 365] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

interface NetWorthRow {
  recorded_at: string;
  portfolio_value: number;
}
interface BenchmarkRow {
  date: string;
  close: number;
}
interface ChartPoint {
  date: string;
  label: string;
  portfolioValue: number;
  close: number;
  portfolioIndex: number;
  benchmarkIndex: number;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

const BenchmarkContent = () => {
  const { hidden, toggle, mask } = usePrivacy();
  const [benchmarkSymbol, setBenchmarkSymbol] = useState<BenchmarkSymbol>('NIFTY50');
  const [windowDays, setWindowDays] = useState<WindowDays>(90);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthRow[]>([]);
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);

  const { selection, handlers, clear } = useChartRangeSelection();

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Ordered newest-first and limited to windowDays+1, then reversed to ascending — the same
      // fetch shape compareToBenchmark uses server-side, so the headline stats below match what
      // the portfolio AI reports for the same question.
      const { data, error } = await supabase
        .from('net_worth_history')
        .select('recorded_at, portfolio_value')
        .order('recorded_at', { ascending: false })
        .limit(windowDays + 1);
      if (error) toast.error(`Failed to load portfolio history: ${error.message}`);
      if (data) setNetWorthHistory((data as NetWorthRow[]).slice().reverse());
      setLoading(false);
    })();
  }, [windowDays]);

  const loadBenchmarkHistory = async (symbol: BenchmarkSymbol, days: WindowDays) => {
    // benchmark_history isn't in the generated Supabase types (see the codegen-drift note on
    // period_reports in Reports.tsx — same root cause), hence the `as any` cast.
    const { data, error } = await supabase
      .from('benchmark_history' as any)
      .select('date, close')
      .eq('symbol', symbol)
      .order('date', { ascending: false })
      .limit(days + 1);
    if (error) { toast.error(`Failed to load benchmark data: ${error.message}`); return; }
    setBenchmarkHistory(((data as unknown as BenchmarkRow[]) ?? []).slice().reverse());
  };

  useEffect(() => {
    loadBenchmarkHistory(benchmarkSymbol, windowDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmarkSymbol, windowDays]);

  const backfillBenchmark = async () => {
    setBackfilling(true);
    const t = toast.loading(`Backfilling ${benchmarkSymbol} data…`);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-benchmark-prices', {
        body: { symbols: [benchmarkSymbol], range: '2y', interval: '1d' },
      });
      if (error) throw error;
      const failed = Object.entries(data?.benchmarks ?? {}).filter(([, v]: [string, any]) => v?.error);
      if (failed.length > 0) throw new Error(failed.map(([sym, v]: [string, any]) => `${sym}: ${v.error}`).join('; '));
      await loadBenchmarkHistory(benchmarkSymbol, windowDays);
      toast.success('Backfilled benchmark data', { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfilling(false);
    }
  };

  // Merge: for each portfolio-value history point, find the last benchmark close at-or-before
  // that date, then rebase both series to 100 at the first point where both are available. This
  // is purely for the chart's visual, date-aligned line-up — the headline stats below are
  // computed independently (see `stats`) to match the MCP tool exactly.
  const { chartData, note } = useMemo(() => {
    if (netWorthHistory.length === 0) return { chartData: [] as ChartPoint[], note: 'No portfolio history yet.' };
    if (benchmarkHistory.length === 0) {
      return { chartData: [] as ChartPoint[], note: `No ${benchmarkSymbol} data yet — backfill it below.` };
    }

    const merged: { date: string; portfolioValue: number; close: number }[] = [];
    let bIdx = 0;
    for (const row of netWorthHistory) {
      const rowTime = new Date(row.recorded_at).getTime();
      while (bIdx + 1 < benchmarkHistory.length && new Date(benchmarkHistory[bIdx + 1].date).getTime() <= rowTime) {
        bIdx++;
      }
      const candidate = benchmarkHistory[bIdx];
      if (candidate && new Date(candidate.date).getTime() <= rowTime) {
        merged.push({ date: row.recorded_at, portfolioValue: Number(row.portfolio_value), close: Number(candidate.close) });
      }
    }

    if (merged.length < 2) {
      return { chartData: [] as ChartPoint[], note: 'Not enough overlapping portfolio + benchmark history yet.' };
    }

    const basePortfolioValue = merged[0].portfolioValue;
    const baseClose = merged[0].close;
    const points: ChartPoint[] = merged.map(m => ({
      date: m.date,
      label: dateLabel(m.date),
      portfolioValue: m.portfolioValue,
      close: m.close,
      portfolioIndex: basePortfolioValue !== 0 ? (m.portfolioValue / basePortfolioValue) * 100 : 100,
      benchmarkIndex: baseClose !== 0 ? (m.close / baseClose) * 100 : 100,
    }));
    return { chartData: points, note: null as string | null };
  }, [netWorthHistory, benchmarkHistory, benchmarkSymbol]);

  // Mirrors compareToBenchmark in supabase/functions/_shared/portfolio-data.ts exactly: each
  // series' return is (last ÷ first − 1) computed independently over its own last windowDays+1
  // snapshots, with no date-matching between the two. Keep this in sync with that function —
  // it's what guarantees this page's numbers match what the portfolio AI reports for the same
  // question, even though the chart above (for readability) date-aligns the two series instead.
  const stats = useMemo(() => {
    if (netWorthHistory.length < 2 || benchmarkHistory.length < 2) return null;
    const portfolioSeries = netWorthHistory.map(r => Number(r.portfolio_value));
    const benchSeries = benchmarkHistory.map(r => Number(r.close));
    const portfolioReturnPercent = portfolioSeries[0] > 0
      ? ((portfolioSeries[portfolioSeries.length - 1] - portfolioSeries[0]) / portfolioSeries[0]) * 100
      : null;
    const benchmarkReturnPercent = benchSeries[0] > 0
      ? ((benchSeries[benchSeries.length - 1] - benchSeries[0]) / benchSeries[0]) * 100
      : null;
    if (portfolioReturnPercent === null || benchmarkReturnPercent === null) return null;
    return {
      portfolioReturnPercent,
      benchmarkReturnPercent,
      outperformancePercent: portfolioReturnPercent - benchmarkReturnPercent,
      windowDays,
      fromLabel: dateLabel(netWorthHistory[0].recorded_at),
      toLabel: dateLabel(netWorthHistory[netWorthHistory.length - 1].recorded_at),
    };
  }, [netWorthHistory, benchmarkHistory, windowDays]);

  const rangeResult =
    selection.startIndex !== null && selection.endIndex !== null
      ? computeRangeReturn(chartData, selection.startIndex, selection.endIndex, 'portfolioIndex', 'label')
      : null;

  const benchmarkLabel = BENCHMARK_OPTIONS.find(b => b.symbol === benchmarkSymbol)?.label ?? benchmarkSymbol;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></Link>
            <div>
              <div className="text-xl font-bold text-foreground flex items-center gap-2">
                <h1 className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Benchmark Comparison</h1>
                <InfoHint title="Benchmark Comparison" side="right" caveat="Uses holdings value only — excludes cash, PF and liabilities, unlike the AUM figure shown elsewhere in the app. Also a different question from the dashboard's XIRR breakdown: this page compares windowed (30–365d) simple returns, not a whole-history, cash-flow-timed XIRR — the two numbers aren't meant to match.">
                  Tracks how your portfolio's holdings have grown compared to a market index, so you can tell whether being invested the way you are has actually beaten just holding the index. Matches what the portfolio AI reports for the same question.
                </InfoHint>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <span>Holdings vs {benchmarkLabel} · last {windowDays}d, rebased to 100 at the start of the shared history</span>
                <InfoHint title="Rebased to 100" side="bottom" formula="value ÷ first overlapping value × 100">
                  Both lines are scaled so they both start at 100 on the first date where portfolio history and {benchmarkLabel} data overlap. This makes the two directly comparable regardless of your portfolio's ₹ size vs. the index's point level — a line at 110 means "+10% from the start," for either series.
                </InfoHint>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={toggle} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground">
              {hidden ? 'Show' : 'Hide'} numbers
            </button>
            <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              Window
              <InfoHint title="Window" side="bottom">
                How many of the most recent days' snapshots to compare — matches the <code>days</code> parameter the portfolio AI's compare_to_benchmark tool accepts (default 90).
              </InfoHint>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {WINDOW_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setWindowDays(d)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition ${windowDays === d ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {BENCHMARK_OPTIONS.map(b => (
                <button
                  key={b.symbol}
                  onClick={() => setBenchmarkSymbol(b.symbol)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${benchmarkSymbol === b.symbol ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <button onClick={backfillBenchmark} disabled={backfilling} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> {backfilling ? 'Backfilling…' : `Backfill ${benchmarkLabel} data`}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : note ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">{note}</p>
            {benchmarkHistory.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">Click "Backfill {benchmarkLabel} data" above, then come back.</p>
            )}
          </div>
        ) : (
          <>
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat
                  label={
                    <LabelWithHint label="Portfolio Return" title="Portfolio Return" side="top" formula="(last portfolio_value ÷ first portfolio_value − 1) × 100, over the last windowDays snapshots">
                      How much your holdings' market value has moved, in % — comparing the oldest and newest of the last {stats.windowDays} recorded snapshots. Excludes cash, PF and liabilities; this is the exact figure the portfolio AI reports for the same question.
                    </LabelWithHint>
                  }
                  value={mask(fmtPct(stats.portfolioReturnPercent))}
                  positive={stats.portfolioReturnPercent >= 0}
                />
                <Stat
                  label={
                    <LabelWithHint label={`${benchmarkLabel} Return`} title={`${benchmarkLabel} Return`} side="top">
                      How much the {benchmarkLabel} index itself moved, in % — the same calculation as Portfolio Return (oldest vs. newest of the last {stats.windowDays} snapshots), but for the index instead of your portfolio.
                    </LabelWithHint>
                  }
                  value={mask(fmtPct(stats.benchmarkReturnPercent))}
                  positive={stats.benchmarkReturnPercent >= 0}
                />
                <Stat
                  label={
                    <LabelWithHint label="Outperformance" title="Outperformance" side="top" formula="Portfolio Return − Benchmark Return">
                      Positive means your portfolio beat {benchmarkLabel} over this window; negative means the index beat you.
                    </LabelWithHint>
                  }
                  value={mask(fmtPct(stats.outperformancePercent))}
                  positive={stats.outperformancePercent >= 0}
                />
                <Stat
                  label={
                    <LabelWithHint label="Window" title="Window" side="top" caveat="Each series' own last N snapshots — not date-matched, so the two may span slightly different calendar ranges if either has gaps.">
                      The lookback you've selected above: the last {stats.windowDays} recorded snapshots for each series, compared independently.
                    </LabelWithHint>
                  }
                  value={`${stats.windowDays}d`}
                  sub={`Portfolio: ${stats.fromLabel} → ${stats.toLabel}`}
                />
              </div>
            )}

            {/* Chart */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-sm font-semibold text-foreground mb-3 inline-flex items-center gap-1">
                <h3>Rebased Performance (start = 100)</h3>
                <InfoHint title="Rebased Performance" side="right" formula="value ÷ first overlapping value × 100" caveat="Date-aligned for a readable chart, so its rebased return can differ very slightly from the headline Portfolio/Benchmark Return stats above.">
                  Green = Portfolio (holdings), blue = {benchmarkLabel}. Both start at 100 on the first overlapping date so you can compare the shape and pace of growth directly — drag across the chart to measure the return over any custom range.
                </InfoHint>
              </div>
              <div className="h-80 relative">
                <ResponsiveContainer>
                  <LineChart data={chartData} {...handlers}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => v.toFixed(0)} />
                    <Tooltip
                      formatter={(v: any, name: string) => [hidden ? '••••••' : Number(v).toFixed(2), name]}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ChartRangeReferenceArea selection={selection} data={chartData} labelKey="label" />
                    <Line type="monotone" dataKey="portfolioIndex" stroke="#22c55e" strokeWidth={2} dot={false} name="Portfolio (holdings)" />
                    <Line type="monotone" dataKey="benchmarkIndex" stroke="#0ea5e9" strokeWidth={2} dot={false} name={benchmarkLabel} />
                  </LineChart>
                </ResponsiveContainer>
                <ChartRangeBadge
                  selection={selection}
                  result={rangeResult}
                  onClear={clear}
                  unit="currency"
                  formatValue={(v) => v.toFixed(2)}
                  valueLabel="Portfolio index"
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              The chart's lines are rebased to 100 at the first date where portfolio history and {benchmarkLabel} data overlap, so they're
              directly comparable regardless of portfolio size. The Portfolio/Benchmark Return stats above use your holdings' market value
              (not overall AUM) over the last {windowDays} days, matching the <code>compare_to_benchmark</code> MCP tool's methodology exactly.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub, positive }: { label: ReactNode; value: string; sub?: string; positive?: boolean }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    {/* div, not <p> — label can carry a LabelWithHint, whose tooltip content itself contains
        block elements (p, div), which is invalid nested inside a <p>. */}
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <p className={`text-lg font-bold mt-1 font-mono ${positive === true ? 'text-green-600' : positive === false ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
  </div>
);

const Benchmark = () => (
  <PrivacyProvider>
    <BenchmarkContent />
  </PrivacyProvider>
);
export default Benchmark;
