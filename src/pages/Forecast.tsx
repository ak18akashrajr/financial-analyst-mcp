import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Activity } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import { InfoHint, LabelWithHint } from '@/components/InfoHint';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';
import { computeRangeReturn } from '@/lib/chartRange';
import { buildValueSeries, flowAdjustedReturns, type SeriesTransaction } from '@/lib/portfolioSeries';
import {
  fitParameters,
  fitCaveats,
  forecastParametric,
  forecastBootstrap,
  backtestForecast,
  MIN_OBSERVATIONS,
  type ForecastMethod,
} from '@/lib/forecast';
import { weightedAssumptions } from '@/lib/assetClassAssumptions';

const HORIZON_OPTIONS = [6, 12, 24, 36, 60] as const;

/** `years: null` means "use all available history" — the default, matching pre-lookback-control behavior. */
const LOOKBACK_OPTIONS: { label: string; years: number | null }[] = [
  { label: '1y', years: 1 },
  { label: '2y', years: 2 },
  { label: '3y', years: 3 },
  { label: '5y', years: 5 },
  { label: 'All', years: null },
];

/** `date` minus `years` years, as `YYYY-MM-DD`. */
function subtractYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(Date.UTC(y - years, m - 1, d));
  return result.toISOString().slice(0, 10);
}

/**
 * Formats a chart tooltip value. Every series here is a plain number EXCEPT `band`, whose recharts
 * `Area` dataKey holds a `[p10, p90]` tuple (the range-Area convention) — formatting that tuple as a
 * single currency figure via `Number()`/`Intl.NumberFormat` silently produced "₹NaN" rather than
 * throwing, which is what shipped to production before this was caught. Exported so this branch has
 * direct unit coverage without needing to drive recharts' own hover/tooltip DOM in a test.
 */
export function formatChartTooltipValue(value: number | [number, number], formatOne: (n: number) => string): string {
  return Array.isArray(value) ? `${formatOne(value[0])} – ${formatOne(value[1])}` : formatOne(value);
}

interface PriceRow {
  symbol: string;
  date: string;
  close: number;
}

function fmt(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtFull(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

/** Adds `monthsAhead` whole months to a `YYYY-MM-DD` date — used to label forecast x-axis points. */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const date = new Date(Date.UTC(year, month, d));
  return date.toISOString().slice(0, 10);
}

interface ChartPoint {
  date: string;
  /** Realized equity + today's cash — only set for dates on or before today. */
  realized?: number;
  /** Forecast median — only set for dates from today onward. */
  p50?: number;
  /** Forecast band, as a [lower, upper] pair for recharts' stacked-area band trick. */
  band?: [number, number];
}

const ForecastContent = () => {
  const { hidden, toggle, mask } = usePrivacy();
  const { transactions, cash, exposure, loading: portfolioLoading } = usePortfolio();

  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [horizonMonths, setHorizonMonths] = useState<number>(24);
  const [method, setMethod] = useState<ForecastMethod>('parametric');
  const [useEwma, setUseEwma] = useState(false);
  // null = all available history — the fit's default, and the pre-lookback-control behavior.
  const [lookbackYears, setLookbackYears] = useState<number | null>(null);

  const symbols = useMemo(
    () => [...new Set(transactions.map((t) => t.symbol))].sort(),
    [transactions],
  );

  const loadPrices = async () => {
    setLoading(true);
    if (symbols.length === 0) {
      setPriceRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('historical_prices')
      .select('symbol, date, close')
      .in('symbol', symbols)
      .order('date', { ascending: true });
    if (error) toast.error(`Failed to load historical prices: ${error.message}`);
    setPriceRows((data ?? []).map((r) => ({ symbol: r.symbol, date: r.date, close: Number(r.close) })));
    setLoading(false);
  };

  useEffect(() => {
    loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  const backfillPrices = async () => {
    if (symbols.length === 0) {
      toast.error('No symbols to backfill');
      return;
    }
    setBackfilling(true);
    const t = toast.loading(`Backfilling ${symbols.length} symbols…`);
    try {
      // Same range/interval as the Reports page's "Backfill FY" button and the Risk Metrics
      // page's benchmark backfill — 2 years of daily closes is the house default for a fit that
      // needs genuine daily granularity rather than the monthly rows RollingReturns writes.
      const { error } = await supabase.functions.invoke('fetch-historical-prices', {
        body: { symbols, range: '2y', interval: '1d' },
      });
      if (error) throw error;
      await loadPrices();
      toast.success(`Backfilled ${symbols.length} symbols`, { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfilling(false);
    }
  };

  const pricesBySymbol = useMemo(() => {
    const map: Record<string, { date: string; close: number }[]> = {};
    for (const r of priceRows) (map[r.symbol] ||= []).push({ date: r.date, close: r.close });
    return map;
  }, [priceRows]);

  const seriesTxns: SeriesTransaction[] = useMemo(
    () => transactions.map((t) => ({ symbol: t.symbol, type: t.type, quantity: t.quantity, price: t.price, date: t.date })),
    [transactions],
  );

  const series = useMemo(() => buildValueSeries(seriesTxns, pricesBySymbol), [seriesTxns, pricesBySymbol]);

  // Lookback restricts what the FIT sees, not what the chart's realized line shows — the chart
  // always plots full history. Filtering happens on the raw (unfiltered-by-completeness) points
  // list, restricted only by date, then handed to flowAdjustedReturns as-is: pre-filtering to only
  // "complete" points here first would let two dates that aren't actually adjacent (because an
  // incomplete stretch sits between them) be treated as a consecutive pair, silently losing whatever
  // netFlow happened during the skipped stretch — the same class of bug fixed in backtestForecast's
  // usableReturnsForBacktest (see src/lib/forecast.ts).
  const lookbackPoints = useMemo(() => {
    if (lookbackYears === null || series.points.length === 0) return series.points;
    const lastDate = series.points[series.points.length - 1].date;
    const cutoff = subtractYears(lastDate, lookbackYears);
    return series.points.filter((p) => p.date >= cutoff);
  }, [series.points, lookbackYears]);

  const returns = useMemo(
    () => flowAdjustedReturns({ ...series, points: lookbackPoints }),
    [series, lookbackPoints],
  );

  // Today's cash/PF/credit-card-debt, added as a flat, non-stochastic offset to every point (past
  // and future) — see src/lib/portfolioSeries.ts's module doc comment for why the fit itself is
  // equity-only. Applying the SAME offset to history too (rather than only to the forecast) is a
  // deliberate simplification: it keeps the chart's units consistent ("total portfolio value") and
  // makes the forecast start exactly where the realized line ends, at the cost of not reflecting
  // what cash actually was on past dates — net_worth_history is too sparse to reconstruct that
  // reliably (see docs/forecasting-plan.md). Called out explicitly in the caveat banner below.
  const cashOffset = cash.liquidCash + cash.vaultCash + cash.pfBalance - cash.creditCardDebt;

  const fallback = useMemo(
    () => weightedAssumptions(exposure.category.map((e) => ({ label: e.label, weight: e.value }))),
    [exposure.category],
  );

  const fit = useMemo(
    () => fitParameters(returns, series.periodsPerYear, fallback),
    [returns, series.periodsPerYear, fallback],
  );

  // The last COMPLETE point, not simply the last point — a held symbol with no price yet would
  // leave the raw last entry incomplete (understated value), which must not become the forecast's
  // starting point or the chart's anchor date.
  const completePoints = useMemo(() => series.points.filter((p) => p.complete), [series.points]);
  const lastPoint = completePoints[completePoints.length - 1];
  const startValue = (lastPoint?.value ?? 0) + cashOffset;

  const fan = useMemo(() => {
    if (!lastPoint) return null;
    const vol = useEwma ? fit.ewmaVolAnnual : fit.volAnnual;
    if (method === 'bootstrap' && fit.sufficient) {
      return forecastBootstrap(startValue, returns, horizonMonths, {
        simulations: 1000,
        periodsPerYear: series.periodsPerYear,
      });
    }
    return forecastParametric(startValue, { driftAnnual: fit.driftAnnual, volAnnual: vol }, horizonMonths, {
      simulations: 1000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPoint, method, fit, returns, horizonMonths, series.periodsPerYear, startValue, useEwma]);

  const caveats = useMemo(() => fitCaveats(fit, series.granularity), [fit, series.granularity]);

  // Walk-forward validation: fit on history up to each of a few cutoffs, forecast horizonMonths
  // ahead from there, and compare against what actually happened next — the honest answer to "why
  // should I believe this band" rather than just asserting it. Runs on `series.points` (not
  // `completePoints`/`returns`) since backtestForecast derives its own internally consistent
  // (usable points, returns) pair per fold — see its doc comment for why reusing this page's own
  // `returns` array would silently misalign whenever an incomplete stretch exists.
  const backtest = useMemo(
    () => backtestForecast(series.points, horizonMonths, series.periodsPerYear, { simulations: 150, folds: 4 }),
    [series.points, horizonMonths, series.periodsPerYear],
  );

  const chartData: ChartPoint[] = useMemo(() => {
    const realized: ChartPoint[] = completePoints.map((p) => ({ date: p.date, realized: p.value + cashOffset }));
    if (!fan || !lastPoint) return realized;
    const forecastPoints: ChartPoint[] = fan.points.slice(1).map((p) => ({
      date: addMonths(lastPoint.date, p.monthsAhead),
      p50: p.p50,
      band: [p.p10, p.p90],
    }));
    // Anchor the forecast segment at the last realized point so the two lines are visually
    // continuous, with no gap and no jump.
    const anchor: ChartPoint = { date: lastPoint.date, realized: startValue, p50: startValue, band: [startValue, startValue] };
    return [...realized.slice(0, -1), anchor, ...forecastPoints];
  }, [completePoints, fan, lastPoint, cashOffset, startValue]);

  // A synthetic combined field so drag-select works across the realized/forecast seam too —
  // computeRangeReturn needs one numeric key per point, and `realized`/`p50` are never both set on
  // the same point except at the anchor, where they're equal. Indices from useChartRangeSelection
  // are positions into whatever array is passed as the chart's own `data` prop, so this must be the
  // exact array rendered below, not a re-filtered copy of it.
  const displayData = useMemo(
    () => chartData.map((d) => ({ ...d, displayValue: d.realized ?? d.p50 ?? 0 })),
    [chartData],
  );

  const rangeSelection = useChartRangeSelection();
  const rangeResult = useMemo(() => {
    if (rangeSelection.selection.startIndex === null || rangeSelection.selection.endIndex === null) return null;
    return computeRangeReturn(displayData, rangeSelection.selection.startIndex, rangeSelection.selection.endIndex, 'displayValue', 'date');
  }, [displayData, rangeSelection.selection]);

  const isLoading = portfolioLoading || loading;
  const hasEnoughHistory = series.points.length >= 2 && returns.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to="/overview" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="text-xl font-bold text-foreground flex items-center gap-2">
                <h1 className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" /> Forecast
                </h1>
                <InfoHint
                  title="Time Series Forecast"
                  side="right"
                  caveat="Fitted from this portfolio's own realized returns, not an assumption — different from the Projections page, which compounds at a chosen or assumed rate."
                >
                  Projects your portfolio's value forward as a percentile band, using drift and volatility fitted
                  from its own historical mark-to-market series — not a fixed assumed return. With too little
                  history it falls back to blended asset-class assumptions, flagged below.
                </InfoHint>
              </div>
              <div className="text-xs text-muted-foreground">
                {series.granularity !== 'unknown' && (
                  <span>{series.granularity} price history · {returns.length} return observations</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={toggle}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground"
            >
              {hidden ? 'Show' : 'Hide'} numbers
            </button>
            <button
              onClick={backfillPrices}
              disabled={backfilling}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" /> {backfilling ? 'Backfilling…' : 'Backfill 2y daily prices'}
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !hasEnoughHistory ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Not enough priced history to build a value series yet — need at least two dates where every held
              symbol has a price.
            </p>
            <p className="text-xs text-muted-foreground">
              Click "Backfill 2y daily prices" above, then come back.
            </p>
          </div>
        ) : (
          <>
            {series.symbolsWithoutPrices.length > 0 && (
              <p className="text-xs text-amber-500">
                ⚠ No price history for: {series.symbolsWithoutPrices.join(', ')} — {series.incompletePoints} date(s)
                excluded from the fit while these were held and unpriced.
              </p>
            )}
            {caveats.map((c, i) => (
              <p key={i} className="text-xs text-amber-500">⚠ {c}</p>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Cash, PF and credit-card debt ({mask(fmtFull(cashOffset))}) are held constant at today's value across
              the whole chart — only the equity portion is modeled and forecast; cash carries no fitted risk.
            </p>

            {/* Controls */}
            <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-end gap-4">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Horizon</Label>
                <div className="flex gap-1 mt-1">
                  {HORIZON_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setHorizonMonths(m)}
                      className={`text-xs px-2.5 py-1.5 rounded-md border ${
                        horizonMonths === m
                          ? 'bg-foreground text-background border-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {m < 12 ? `${m}mo` : `${m / 12}y`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Lookback</Label>
                  <InfoHint
                    title="Lookback window"
                    side="bottom"
                    caveat="Restricts only the fit — the realized line on the chart always shows full history regardless of this setting."
                  >
                    How much trailing price history the fit uses to estimate drift and volatility. "All" uses
                    everything available; a shorter window reacts faster to a recent regime change but has fewer
                    observations to fit from — check the observation count doesn't drop below {MIN_OBSERVATIONS}.
                  </InfoHint>
                </div>
                <div className="flex gap-1 mt-1">
                  {LOOKBACK_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => setLookbackYears(opt.years)}
                      className={`text-xs px-2.5 py-1.5 rounded-md border ${
                        lookbackYears === opt.years
                          ? 'bg-foreground text-background border-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                {/* The hint sits next to the label, not inside a TabsTrigger — nesting InfoHint's
                    own <button> inside a Radix tab trigger (itself a <button>) is invalid HTML
                    (button-in-button) and breaks keyboard/screen-reader semantics for the tab. */}
                <div className="flex items-center gap-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Method</Label>
                  <InfoHint
                    title="Forecast method"
                    side="bottom"
                    formula="Parametric: v *= exp((μ − σ²/2)/12 + σ/√12 · Z)"
                    caveat={`Bootstrap needs at least ${MIN_OBSERVATIONS} return observations; falls back to parametric otherwise.`}
                  >
                    Parametric is a log-normal random walk using the fitted drift and volatility — assumes returns
                    are normally distributed. Bootstrap instead resamples contiguous blocks of the portfolio's own
                    observed returns, with no distributional assumption, so real fat tails and volatility clustering
                    carry through.
                  </InfoHint>
                </div>
                <Tabs value={method} onValueChange={(v) => setMethod(v as ForecastMethod)} className="mt-1">
                  <TabsList>
                    <TabsTrigger value="parametric" className="text-xs">Parametric</TabsTrigger>
                    <TabsTrigger value="bootstrap" className="text-xs">Bootstrap</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {method === 'parametric' && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-1.5">
                  <input type="checkbox" checked={useEwma} onChange={(e) => setUseEwma(e.target.checked)} />
                  Use EWMA volatility (weights recent regime more)
                </label>
              )}
            </div>

            {/* Fit stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label={<LabelWithHint label="Fitted Drift" title="Fitted Annualized Drift" side="top" formula="mean(flow-adjusted returns) × periods/year">Annualized market return implied by this portfolio's own history.</LabelWithHint>}
                value={mask(`${fit.driftAnnual >= 0 ? '+' : ''}${(fit.driftAnnual * 100).toFixed(1)}%`)}
                positive={fit.driftAnnual >= 0}
              />
              <Stat
                label={<LabelWithHint label="Fitted Volatility" title="Fitted Annualized Volatility" side="top" formula="stdev(flow-adjusted returns) × √(periods/year)">Annualized standard deviation of the same return series.</LabelWithHint>}
                value={mask(`${((useEwma ? fit.ewmaVolAnnual : fit.volAnnual) * 100).toFixed(1)}%`)}
              />
              <Stat
                label={<LabelWithHint label="Current Value" title="Starting Value" side="top">Equity + cash/PF − credit-card debt, today.</LabelWithHint>}
                value={mask(fmt(startValue))}
              />
              <Stat
                label={<LabelWithHint label={`Median in ${horizonMonths < 12 ? `${horizonMonths}mo` : `${horizonMonths / 12}y`}`} title="Median Forecast" side="top">The p50 path's terminal value at the selected horizon.</LabelWithHint>}
                value={mask(fan ? fmt(fan.terminal.p50) : '—')}
              />
            </div>

            {/* Chart */}
            <div className="rounded-lg border border-border bg-card p-4 relative">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart
                  data={displayData}
                  onMouseDown={rangeSelection.handlers.onMouseDown}
                  onMouseMove={rangeSelection.handlers.onMouseMove}
                  onMouseUp={rangeSelection.handlers.onMouseUp}
                  onMouseLeave={rangeSelection.handlers.onMouseLeave}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" minTickGap={40} />
                  <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={(v) => mask(fmt(v))} width={70} />
                  <Tooltip
                    formatter={(value: number | [number, number], name: string) => [
                      mask(formatChartTooltipValue(value, fmtFull)),
                      name,
                    ]}
                    labelFormatter={(label) => label}
                  />
                  <ChartRangeReferenceArea selection={rangeSelection.selection} data={displayData} labelKey="date" />
                  <Area
                    dataKey="band"
                    stroke="none"
                    fill="hsl(213, 75%, 55%)"
                    fillOpacity={0.15}
                    name="p10–p90 band"
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line dataKey="realized" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} name="Realized" connectNulls isAnimationActive={false} />
                  <Line dataKey="p50" stroke="hsl(213, 75%, 55%)" strokeWidth={2} strokeDasharray="4 3" dot={false} name="Median forecast" connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <ChartRangeBadge
                selection={rangeSelection.selection}
                result={rangeResult}
                onClear={rangeSelection.clear}
                unit="currency"
                valueLabel="Value"
              />
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              The shaded band is the p10–p90 range across {fan?.simulations ?? 0} simulated paths, fitted from{' '}
              {fit.observations} flow-adjusted return observations
              {fit.usedFallback ? ' (fell back to asset-class assumptions — see caveat above)' : ''}. Not investment
              advice — a statistical projection of what this portfolio's own history implies, nothing more.
            </p>

            {/* Backtest */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Backtest</h2>
                <InfoHint
                  title="Walk-forward backtest"
                  side="right"
                  formula="fit on history up to a cutoff → forecast horizonMonths ahead → compare to what actually happened"
                  caveat="A short or thin price history produces too few cutoffs to backtest at all — this isn't a sign the forecast itself is wrong, just that there isn't enough history yet to check it."
                >
                  Re-fits this same model at a few earlier points in time, projects forward exactly
                  {' '}{horizonMonths} month{horizonMonths === 1 ? '' : 's'} from each, and checks whether what
                  actually happened next fell inside the predicted p10–p90 band — the honest answer to "why should I
                  believe this band" rather than just asserting it.
                </InfoHint>
              </div>

              {backtest.folds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Not enough history yet to backtest at this horizon — needs at least {MIN_OBSERVATIONS} return
                  observations before the earliest cutoff, plus a full {horizonMonths}-month horizon of real data
                  after it. Try a shorter horizon, or come back once more price history has been backfilled.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat
                      label={
                        <LabelWithHint
                          label="Band Coverage"
                          title="Coverage"
                          side="top"
                          formula="folds where the actual value fell inside p10–p90 ÷ total folds"
                          caveat="Should land near 80% for a well-calibrated 10th-90th-percentile band — well under means the band is too narrow to be believed; well over means it's too wide to be useful."
                        >
                          Share of past cutoffs where the real outcome landed inside the predicted band.
                        </LabelWithHint>
                      }
                      value={`${(backtest.coverage * 100).toFixed(0)}% (${backtest.folds.filter((f) => f.covered).length}/${backtest.folds.length})`}
                      positive={backtest.coverage >= 0.5 && backtest.coverage <= 1}
                    />
                    <Stat
                      label={
                        <LabelWithHint label="Median Error" title="Median Absolute Error" side="top" formula="median(|predicted p50 − actual| ÷ actual)">
                          Typical gap between the predicted median and what actually happened, across all folds.
                        </LabelWithHint>
                      }
                      value={`${backtest.medianAbsErrorPercent.toFixed(1)}%`}
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr className="text-left">
                          <th className="font-medium px-2 py-1.5">Cutoff</th>
                          <th className="font-medium px-2 py-1.5">Predicted p10–p90</th>
                          <th className="font-medium px-2 py-1.5">Actual</th>
                          <th className="font-medium px-2 py-1.5">Covered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtest.folds.map((f) => (
                          <tr key={f.cutoffDate} className="border-b border-border last:border-0">
                            <td className="px-2 py-1.5 text-foreground">{f.cutoffDate}</td>
                            <td className="px-2 py-1.5 font-mono">{mask(`${fmt(f.predictedP10)} – ${fmt(f.predictedP90)}`)}</td>
                            <td className="px-2 py-1.5 font-mono">{mask(fmt(f.actual))}</td>
                            <td className={`px-2 py-1.5 ${f.covered ? 'text-green-600' : 'text-red-600'}`}>
                              {f.covered ? '✓' : '✗'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, positive }: { label: React.ReactNode; value: string; positive?: boolean }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <p className={`text-lg font-bold mt-1 font-mono ${positive === true ? 'text-green-600' : positive === false ? 'text-red-600' : 'text-foreground'}`}>
      {value}
    </p>
  </div>
);

const Forecast = () => (
  <PrivacyProvider>
    <ForecastContent />
  </PrivacyProvider>
);
export default Forecast;
