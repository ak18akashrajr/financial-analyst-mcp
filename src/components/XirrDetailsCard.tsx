import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { computeBenchmarkXirr, type BenchmarkPricePoint, type BenchmarkXirrResult } from '@/lib/benchmarkXirr';
import { formatYearsToDouble, yearsToDouble } from '@/lib/timeToDouble';
import type { Transaction } from '@/types/portfolio';

// Mirrors BENCHMARK_TICKERS in supabase/functions/fetch-benchmark-prices/index.ts and
// BENCHMARK_OPTIONS in src/pages/Benchmark.tsx — the friendly symbols benchmark_history is
// keyed by.
const BENCHMARKS = [
  { symbol: 'NIFTY500', label: 'NIFTY 500' },
  { symbol: 'SPX', label: 'S&P 500' },
] as const;

interface BenchmarkState {
  status: 'idle' | 'loading' | 'backfilling' | 'ready' | 'error';
  result: BenchmarkXirrResult | null;
  error: string | null;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

async function fetchBenchmarkHistory(symbol: string): Promise<BenchmarkPricePoint[]> {
  // benchmark_history isn't in the generated Supabase types (see src/pages/Benchmark.tsx's
  // same-cause comment), hence the `as any` cast.
  const { data, error } = await supabase
    .from('benchmark_history' as any)
    .select('date, close')
    .eq('symbol', symbol)
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as BenchmarkPricePoint[]) ?? []).map(r => ({ date: r.date, close: Number(r.close) }));
}

interface Props {
  /** Overall Portfolio XIRR — currently identical to `portfolioXirr` (see PortfolioSummary.xirrExPf). */
  overallXirr: number | null;
  /** XIRR excluding any transaction-backed holding tagged PPF/EPF. */
  portfolioXirr: number | null;
  transactions: Transaction[];
}

/**
 * Click-to-expand breakdown behind the dashboard's XIRR stat: Overall Portfolio XIRR, Portfolio
 * XIRR (ex-PF holdings), and — computed on first open — the XIRR you'd have gotten investing the
 * exact same amounts on the exact same dates into NIFTY 500 / S&P 500 instead. See
 * docs/xirr-breakdown.md for the full methodology and why the manual PF balance can't be part of
 * any of these numbers.
 */
export function XirrDetailsCard({ overallXirr, portfolioXirr, transactions }: Props) {
  const [open, setOpen] = useState(false);
  const [benchmarks, setBenchmarks] = useState<Record<string, BenchmarkState>>({});
  const [loaded, setLoaded] = useState(false);

  const runBenchmarks = async () => {
    setLoaded(true);
    const earliestTxnDate = transactions.length > 0
      ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0].date)
      : null;

    for (const { symbol } of BENCHMARKS) {
      setBenchmarks(prev => ({ ...prev, [symbol]: { status: 'loading', result: null, error: null } }));
      try {
        let prices = await fetchBenchmarkHistory(symbol);

        // If coverage doesn't reach back as far as the earliest transaction, pull the fullest
        // history Yahoo will give us before computing — best-effort; any transactions still
        // older than what's returned are excluded and surfaced via the caveat below, not
        // silently dropped.
        const needsBackfill = earliestTxnDate != null && (prices.length === 0 || prices[0].date > earliestTxnDate);
        if (needsBackfill) {
          setBenchmarks(prev => ({ ...prev, [symbol]: { status: 'backfilling', result: null, error: null } }));
          const { error: fnError } = await supabase.functions.invoke('fetch-benchmark-prices', {
            body: { symbols: [symbol], range: 'max', interval: '1d' },
          });
          if (fnError) throw new Error(fnError.message);
          prices = await fetchBenchmarkHistory(symbol);
        }

        const result = computeBenchmarkXirr(transactions, prices);
        setBenchmarks(prev => ({ ...prev, [symbol]: { status: 'ready', result, error: null } }));
      } catch (e: any) {
        setBenchmarks(prev => ({ ...prev, [symbol]: { status: 'error', result: null, error: e?.message ?? String(e) } }));
      }
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !loaded) runBenchmarks();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="lg:col-span-3 rounded-2xl border border-border bg-card p-5 flex flex-col justify-between min-h-[180px] text-left cursor-pointer hover:border-foreground/30 transition-colors"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-foreground/5 text-foreground">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">XIRR</p>
            <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${overallXirr != null ? (overallXirr >= 0 ? 'text-gain' : 'text-loss') : 'text-foreground'}`}>
              {overallXirr != null ? `${(overallXirr * 100).toFixed(2)}%` : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Annualized return · click for breakdown</p>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-xs font-semibold text-foreground">XIRR Breakdown</p>

        <Row label="Overall Portfolio XIRR" value={fmtPct(overallXirr)} tone={toneOf(overallXirr)} xirr={overallXirr} />
        <Row label="Portfolio XIRR (ex-PF holdings)" value={fmtPct(portfolioXirr)} tone={toneOf(portfolioXirr)} xirr={portfolioXirr} />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Stocks, ETFs, Mutual Funds &amp; other transaction-backed holdings only — same as the Holdings table. The
          manual PF (PPF/EPF) balance in Cash Management isn't included in either number above: it has no dated
          contribution history to build cash flows from, so no real XIRR can be computed for it. Time-to-double is
          ln(2) ÷ ln(1 + rate) — shown as "—" when the rate is zero or negative, since it never doubles.
        </p>

        <div className="border-t border-border pt-2.5 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">Benchmark — same money, same dates, index instead</p>
          {BENCHMARKS.map(b => (
            <BenchmarkRow key={b.symbol} label={b.label} state={benchmarks[b.symbol]} />
          ))}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Whole-history XIRR from replaying every transaction into the index on the same date/amount — a different
            question from the <Link to="/benchmark" className="underline hover:text-foreground">Benchmark page</Link>'s
            windowed (30–365d) simple return. Different methodology and window, not a discrepancy.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toneOf(n: number | null): 'gain' | 'loss' | 'default' {
  if (n == null) return 'default';
  return n >= 0 ? 'gain' : 'loss';
}

function Row({ label, value, tone, xirr }: { label: string; value: string; tone: 'gain' | 'loss' | 'default'; xirr: number | null }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={`font-mono font-semibold ${tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-foreground'}`}>
          {value}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{formatYearsToDouble(yearsToDouble(xirr))}</span>
      </span>
    </div>
  );
}

function BenchmarkRow({ label, state }: { label: string; state: BenchmarkState | undefined }) {
  if (!state || state.status === 'loading') {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (state.status === 'backfilling') {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> backfilling history…
        </span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-[10px] text-loss">failed to load</span>
      </div>
    );
  }

  const r = state.result;
  const tone = toneOf(r?.xirr ?? null);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`font-mono font-semibold ${tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-foreground'}`}>
            {fmtPct(r?.xirr ?? null)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{formatYearsToDouble(yearsToDouble(r?.xirr ?? null))}</span>
        </span>
      </div>
      {r && r.excludedCount > 0 && (
        <p className="text-[10px] leading-relaxed text-amber-500">
          ⚠ {r.excludedCount} of {r.totalCount} transactions excluded — no {label} data before{' '}
          {r.earliestAvailableDate ? dateLabel(r.earliestAvailableDate) : 'any date'}
          {r.earliestNeededDate ? ` (earliest transaction: ${dateLabel(r.earliestNeededDate)})` : ''}.
        </p>
      )}
    </div>
  );
}
