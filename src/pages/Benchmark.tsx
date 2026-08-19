import { useEffect, useMemo, useState } from 'react';
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

// Mirrors BENCHMARK_TICKERS in supabase/functions/fetch-benchmark-prices/index.ts — the friendly
// symbols benchmark_history is keyed by (not the underlying Yahoo tickers).
const BENCHMARK_OPTIONS = [
  { symbol: 'NIFTY50', label: 'NIFTY 50' },
  { symbol: 'NIFTY500', label: 'NIFTY 500' },
  { symbol: 'SPX', label: 'S&P 500' },
] as const;
type BenchmarkSymbol = (typeof BENCHMARK_OPTIONS)[number]['symbol'];

interface NetWorthRow {
  recorded_at: string;
  net_worth: number;
}
interface BenchmarkRow {
  date: string;
  close: number;
}
interface ChartPoint {
  date: string;
  label: string;
  netWorth: number;
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
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthRow[]>([]);
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);

  const { selection, handlers, clear } = useChartRangeSelection();

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('net_worth_history')
        .select('recorded_at, net_worth')
        .order('recorded_at', { ascending: true });
      if (error) toast.error(`Failed to load AUM history: ${error.message}`);
      if (data) setNetWorthHistory(data as NetWorthRow[]);
      setLoading(false);
    })();
  }, []);

  const loadBenchmarkHistory = async (symbol: BenchmarkSymbol) => {
    // benchmark_history isn't in the generated Supabase types (see the codegen-drift note on
    // period_reports in Reports.tsx — same root cause), hence the `as any` cast.
    const { data, error } = await supabase
      .from('benchmark_history' as any)
      .select('date, close')
      .eq('symbol', symbol)
      .order('date', { ascending: true });
    if (error) { toast.error(`Failed to load benchmark data: ${error.message}`); return; }
    setBenchmarkHistory((data as unknown as BenchmarkRow[]) ?? []);
  };

  useEffect(() => {
    loadBenchmarkHistory(benchmarkSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmarkSymbol]);

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
      await loadBenchmarkHistory(benchmarkSymbol);
      toast.success('Backfilled benchmark data', { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfilling(false);
    }
  };

  // Merge: for each AUM history point, find the last benchmark close at-or-before that date, then
  // rebase both series to 100 at the first point where both are available.
  const { chartData, note } = useMemo(() => {
    if (netWorthHistory.length === 0) return { chartData: [] as ChartPoint[], note: 'No AUM history yet.' };
    if (benchmarkHistory.length === 0) {
      return { chartData: [] as ChartPoint[], note: `No ${benchmarkSymbol} data yet — backfill it below.` };
    }

    const merged: { date: string; netWorth: number; close: number }[] = [];
    let bIdx = 0;
    for (const row of netWorthHistory) {
      const rowTime = new Date(row.recorded_at).getTime();
      while (bIdx + 1 < benchmarkHistory.length && new Date(benchmarkHistory[bIdx + 1].date).getTime() <= rowTime) {
        bIdx++;
      }
      const candidate = benchmarkHistory[bIdx];
      if (candidate && new Date(candidate.date).getTime() <= rowTime) {
        merged.push({ date: row.recorded_at, netWorth: Number(row.net_worth), close: Number(candidate.close) });
      }
    }

    if (merged.length < 2) {
      return { chartData: [] as ChartPoint[], note: 'Not enough overlapping AUM + benchmark history yet.' };
    }

    const baseNetWorth = merged[0].netWorth;
    const baseClose = merged[0].close;
    const points: ChartPoint[] = merged.map(m => ({
      date: m.date,
      label: dateLabel(m.date),
      netWorth: m.netWorth,
      close: m.close,
      portfolioIndex: baseNetWorth !== 0 ? (m.netWorth / baseNetWorth) * 100 : 100,
      benchmarkIndex: baseClose !== 0 ? (m.close / baseClose) * 100 : 100,
    }));
    return { chartData: points, note: null as string | null };
  }, [netWorthHistory, benchmarkHistory, benchmarkSymbol]);

  const stats = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const portfolioReturnPercent = last.portfolioIndex - 100;
    const benchmarkReturnPercent = last.benchmarkIndex - 100;
    const windowDays = Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000);
    return {
      portfolioReturnPercent,
      benchmarkReturnPercent,
      outperformancePercent: portfolioReturnPercent - benchmarkReturnPercent,
      windowDays,
      fromLabel: first.label,
      toLabel: last.label,
    };
  }, [chartData]);

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
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Benchmark Comparison</h1>
              <p className="text-xs text-muted-foreground">AUM vs {benchmarkLabel} · rebased to 100 at the start of the shared history</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={toggle} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground">
              {hidden ? 'Show' : 'Hide'} numbers
            </button>
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
                <Stat label="Portfolio Return" value={mask(fmtPct(stats.portfolioReturnPercent))} positive={stats.portfolioReturnPercent >= 0} />
                <Stat label={`${benchmarkLabel} Return`} value={mask(fmtPct(stats.benchmarkReturnPercent))} positive={stats.benchmarkReturnPercent >= 0} />
                <Stat label="Outperformance" value={mask(fmtPct(stats.outperformancePercent))} positive={stats.outperformancePercent >= 0} />
                <Stat label="Window" value={`${stats.windowDays}d`} sub={`${stats.fromLabel} → ${stats.toLabel}`} />
              </div>
            )}

            {/* Chart */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">Rebased Performance (start = 100)</h3>
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
                    <Line type="monotone" dataKey="portfolioIndex" stroke="#22c55e" strokeWidth={2} dot={false} name="Portfolio (AUM)" />
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
              Both series are rebased to 100 at the first date where AUM history and {benchmarkLabel} data overlap, so the
              lines are directly comparable regardless of portfolio size. Portfolio return uses AUM (holdings + cash + PF −
              liabilities), matching the <code>compare_to_benchmark</code> MCP tool's methodology.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
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
