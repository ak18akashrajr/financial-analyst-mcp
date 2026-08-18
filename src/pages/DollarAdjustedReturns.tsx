import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { SiteFooter } from '@/components/SiteFooter';
import { AuditPopover, AuditSection, AuditTable, Formula } from '@/components/AuditPopover';
import { useDollarReturns } from '@/hooks/useDollarReturns';
import { fmtInr, fmtUsd, rateOn } from '@/lib/fx';
import { AlertTriangle, Database, DollarSign, Download, RefreshCw } from 'lucide-react';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';

const RANGES = [
  { key: '1y', years: 1 },
  { key: '3y', years: 3 },
  { key: '5y', years: 5 },
  { key: 'max', years: 100 },
] as const;

function Content() {
  const { mask } = usePrivacy();
  const {
    loading,
    rates,
    spot,
    spotRow,
    metrics,
    loadingFx,
    refreshing,
    backfilling,
    refreshFx,
    backfillFx,
    lastAttempts,
  } = useDollarReturns();

  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('5y');
  const [nwHistory, setNwHistory] = useState<Array<{ date: string; inr: number }>>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('net_worth_history')
        .select('net_worth, recorded_at')
        .order('recorded_at', { ascending: true })
        .limit(1000);
      setNwHistory(
        (data ?? []).map((r) => ({
          date: new Date(r.recorded_at as string).toISOString().slice(0, 10),
          inr: Number(r.net_worth),
        }))
      );
    })();
  }, []);

  const usdInr = (n: number) => mask(fmtUsd(n));
  const inr = (n: number) => mask(fmtInr(n));

  const rateSeries = useMemo(() => {
    const years = RANGES.find((r) => r.key === range)!.years;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    const iso = cutoff.toISOString().slice(0, 10);
    return rates.filter((r) => r.date >= iso).map((r) => ({ date: r.date, rate: r.rate }));
  }, [rates, range]);

  const dualSeries = useMemo(() => {
    if (!rates.length) return [];
    return nwHistory.map((p) => {
      const look = rateOn(rates, p.date);
      const rate = look?.rate ?? spot;
      return { date: p.date, inr: p.inr, usd: rate ? p.inr / rate : 0 };
    });
  }, [nwHistory, rates, spot]);

  const dualRange = useChartRangeSelection();
  const dualRangeResult =
    dualRange.selection.startIndex !== null && dualRange.selection.endIndex !== null
      ? computeRangeReturn(dualSeries, dualRange.selection.startIndex, dualRange.selection.endIndex, 'usd', 'date')
      : null;

  const rateRange = useChartRangeSelection();
  const rateRangeResult =
    rateRange.selection.startIndex !== null && rateRange.selection.endIndex !== null
      ? computeRangeReturn(rateSeries, rateRange.selection.startIndex, rateRange.selection.endIndex, 'rate', 'date')
      : null;

  const provenance = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rates) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rates]);

  if (loading || loadingFx) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading dollar-adjusted view…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-3 px-1">
          <div>
            <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-2 font-mono">
              Currency Analytics
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight flex items-center gap-2">
              <DollarSign className="w-6 h-6" /> Dollar-Adjusted Returns
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
              Portfolio performance restated in hard currency. Every rupee cashflow is translated at the
              USD-INR rate effective on its trade date, isolating asset performance from currency translation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshFx}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh FX
            </button>
            <button
              onClick={() => backfillFx('10y')}
              disabled={backfilling}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition disabled:opacity-40"
            >
              <Download className={`w-3.5 h-3.5 ${backfilling ? 'animate-pulse' : ''}`} />
              Backfill 10Y history
            </button>
          </div>
        </div>

        {!metrics ? (
          <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            No USD-INR rates stored yet. Click <span className="text-foreground font-medium">Backfill 10Y history</span> to
            populate rates from the free sources.
          </div>
        ) : (
          <>
            {/* Spot strip */}
            <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-3">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">USD / INR</span>
                <span className="text-xl font-semibold font-mono text-foreground">{spot.toFixed(4)}</span>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                {spotRow?.source} · as of {spotRow?.date} · {rates.length} daily rates stored
              </span>
            </div>

            {metrics.approximatedCount > 0 && (
              <div className="rounded-xl border border-loss/30 bg-loss/5 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-loss mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {metrics.approximatedCount} holding(s) have trades on dates with no exact quoted rate (weekends,
                  market holidays or dates outside the stored window). The nearest prior rate was used and the exact
                  rate, its source and its effective date are disclosed in each audit popover — no rate is estimated.
                </p>
              </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi
                title="USD-Denominated AUM"
                value={usdInr(metrics.aumUsd)}
                sub={inr(metrics.aumUsd * spot)}
                audit={
                  <>
                    <AuditSection label="Formula">
                      <Formula>AUM (USD) = AUM (INR) ÷ spot USDINR</Formula>
                    </AuditSection>
                    <AuditSection label="Inputs">
                      <AuditTable
                        headers={['Input', 'Value']}
                        rows={[
                          ['AUM (INR)', fmtInr(metrics.aumUsd * spot)],
                          ['Spot USDINR', spot.toFixed(4)],
                          ['Rate source', spotRow?.source ?? '—'],
                          ['Rate date', spotRow?.date ?? '—'],
                        ]}
                      />
                    </AuditSection>
                  </>
                }
              />
              <Kpi
                title="Capital Deployed (USD)"
                value={usdInr(metrics.investedUsd)}
                sub={`Avg entry rate ${metrics.attr.avgEntryRate.toFixed(2)}`}
                audit={
                  <>
                    <AuditSection label="Formula">
                      <Formula>Σ (buy amount ÷ rate on trade date) − proportional cost released on sells</Formula>
                    </AuditSection>
                    <AuditSection label="Cashflows converted">
                      <AuditTable
                        headers={['Date', 'INR', 'Rate', 'USD']}
                        rows={metrics.flows
                          .slice(-25)
                          .map((f) => [
                            f.date.toISOString().slice(0, 10),
                            Math.round(f.inr).toLocaleString('en-IN'),
                            `${f.rate.toFixed(3)}${f.exact ? '' : '*'}`,
                            Math.round(f.usd).toLocaleString('en-US'),
                          ])}
                        footer={['* nearest prior rate used', '', '', '']}
                      />
                    </AuditSection>
                  </>
                }
              />
              <Kpi
                title="Alpha in USD"
                value={usdInr(metrics.alphaUsd)}
                sub={`${metrics.usdReturnPct >= 0 ? '+' : ''}${metrics.usdReturnPct.toFixed(2)}% vs ${
                  metrics.inrReturnPct >= 0 ? '+' : ''
                }${metrics.inrReturnPct.toFixed(2)}% INR`}
                tone={metrics.alphaUsd >= 0 ? 'gain' : 'loss'}
                audit={
                  <>
                    <AuditSection label="Formula">
                      <Formula>Alpha (USD) = Current value (USD) − Capital deployed (USD)</Formula>
                    </AuditSection>
                    <AuditSection label="Inputs">
                      <AuditTable
                        headers={['Input', 'Value']}
                        rows={[
                          ['Current value (USD)', fmtUsd(metrics.currentUsd)],
                          ['Capital deployed (USD)', fmtUsd(metrics.investedUsd)],
                          ['Alpha (INR)', fmtInr(metrics.alphaInr)],
                          ['Spot USDINR', spot.toFixed(4)],
                        ]}
                      />
                    </AuditSection>
                  </>
                }
              />
              <Kpi
                title="XIRR — USD vs INR"
                value={metrics.xirrUsd != null ? `${metrics.xirrUsd.toFixed(2)}%` : '—'}
                sub={metrics.xirrInr != null ? `INR XIRR ${metrics.xirrInr.toFixed(2)}%` : 'INR XIRR —'}
                tone={metrics.xirrUsd != null && metrics.xirrUsd >= 0 ? 'gain' : 'loss'}
                audit={
                  <>
                    <AuditSection label="Formula">
                      <Formula>
                        Newton-Raphson XIRR over USD cashflows (each trade ÷ its trade-date rate), terminal flow ={' '}
                        current value ÷ spot
                      </Formula>
                    </AuditSection>
                    <AuditSection label="Inputs">
                      <AuditTable
                        headers={['Input', 'Value']}
                        rows={[
                          ['Cashflows', String(metrics.flows.length)],
                          ['Terminal value (USD)', fmtUsd(metrics.currentUsd)],
                          ['USD XIRR', metrics.xirrUsd != null ? `${metrics.xirrUsd.toFixed(2)}%` : '—'],
                          ['INR XIRR', metrics.xirrInr != null ? `${metrics.xirrInr.toFixed(2)}%` : '—'],
                        ]}
                      />
                    </AuditSection>
                  </>
                }
              />
            </div>

            {/* Attribution */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">Return Attribution</h2>
              <p className="text-xs text-muted-foreground mb-4">
                (1 + USD return) = (1 + INR return) × (avg entry rate ÷ spot rate)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AttrCell label="Asset return (INR)" pct={metrics.attr.assetReturnPct} />
                <AttrCell label="Currency translation effect" pct={metrics.attr.currencyEffectPct} />
                <AttrCell label="Total USD return" pct={metrics.attr.totalUsdReturnPct} strong />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 font-mono">
                Avg entry rate {metrics.attr.avgEntryRate.toFixed(4)} → spot {spot.toFixed(4)}
              </p>
            </div>

            {/* Dual axis chart */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">AUM — INR vs USD</h2>
              {dualSeries.length < 2 ? (
                <p className="text-xs text-muted-foreground">Not enough net worth snapshots yet.</p>
              ) : (
                <div className="relative">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={dualSeries} {...dualRange.handlers}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis yAxisId="l" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <ChartRangeReferenceArea selection={dualRange.selection} data={dualSeries} labelKey="date" />
                      <Line yAxisId="l" type="monotone" dataKey="inr" name="AUM (INR)" stroke="hsl(var(--foreground))" dot={false} strokeWidth={2} />
                      <Line yAxisId="r" type="monotone" dataKey="usd" name="AUM (USD)" stroke="hsl(var(--gain))" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                  <ChartRangeBadge
                    selection={dualRange.selection}
                    result={dualRangeResult}
                    onClear={dualRange.clear}
                    unit="currency"
                    formatValue={fmtUsd}
                    valueLabel="AUM (USD)"
                  />
                </div>
              )}
            </div>

            {/* Rate history */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">USD-INR History</h2>
                <div className="flex items-center gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${
                        range === r.key
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {r.key.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              {rateSeries.length < 2 ? (
                <p className="text-xs text-muted-foreground">No rate history for this range — backfill first.</p>
              ) : (
                <div className="relative">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={rateSeries} {...rateRange.handlers}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" minTickGap={40} />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <ChartRangeReferenceArea selection={rateRange.selection} data={rateSeries} labelKey="date" />
                      <Area type="monotone" dataKey="rate" stroke="hsl(var(--foreground))" fill="hsl(var(--foreground))" fillOpacity={0.08} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <ChartRangeBadge
                    selection={rateRange.selection}
                    result={rateRangeResult}
                    onClear={rateRange.clear}
                    unit="currency"
                    formatValue={(v) => v.toFixed(4)}
                    valueLabel="USD-INR"
                  />
                </div>
              )}
            </div>

            {/* Per-holding */}
            <div className="rounded-2xl border border-border bg-card p-5 overflow-x-auto">
              <h2 className="text-sm font-semibold text-foreground mb-3">Holding-Level Currency Impact</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 font-medium">Symbol</th>
                    <th className="py-2 font-medium text-right">Deployed (USD)</th>
                    <th className="py-2 font-medium text-right">Value (USD)</th>
                    <th className="py-2 font-medium text-right">INR %</th>
                    <th className="py-2 font-medium text-right">USD %</th>
                    <th className="py-2 font-medium text-right">FX impact</th>
                    <th className="py-2 font-medium text-right">Avg entry rate</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.holdingRows
                    .slice()
                    .sort((a, b) => b.currentUsd - a.currentUsd)
                    .map((r) => (
                      <tr key={r.symbol} className="border-b border-border/50">
                        <td className="py-2 font-medium text-foreground">
                          {r.symbol}
                          {r.approximated && <span className="text-muted-foreground" title="Nearest prior rate used"> *</span>}
                        </td>
                        <td className="py-2 text-right font-mono">{mask(fmtUsd(r.investedUsd))}</td>
                        <td className="py-2 text-right font-mono">{mask(fmtUsd(r.currentUsd))}</td>
                        <td className={`py-2 text-right font-mono ${r.inrReturnPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {r.inrReturnPct >= 0 ? '+' : ''}{r.inrReturnPct.toFixed(2)}%
                        </td>
                        <td className={`py-2 text-right font-mono ${r.usdReturnPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {r.usdReturnPct >= 0 ? '+' : ''}{r.usdReturnPct.toFixed(2)}%
                        </td>
                        <td className={`py-2 text-right font-mono ${r.currencyImpactPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {r.currencyImpactPct >= 0 ? '+' : ''}{r.currencyImpactPct.toFixed(2)}%
                        </td>
                        <td className="py-2 text-right font-mono text-muted-foreground">{r.avgBuyRate.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-2">* nearest prior rate used for at least one trade date.</p>
            </div>
          </>
        )}

        {/* Provenance */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Database className="w-4 h-4" /> Data Provenance
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Free sources are tried in order: Yahoo Finance (USDINR=X) → Frankfurter (ECB) → open.er-api.com → database
            cache. Every stored rate records the source it came from.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Stored rates by source</p>
              {provenance.length === 0 ? (
                <p className="text-xs text-muted-foreground">None stored.</p>
              ) : (
                <ul className="space-y-1">
                  {provenance.map(([src, n]) => (
                    <li key={src} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{src}</span>
                      <span className="font-mono text-muted-foreground">{n} rows</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Last fetch attempt chain</p>
              {lastAttempts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No fetch this session.</p>
              ) : (
                <ul className="space-y-1">
                  {lastAttempts.map((a, i) => (
                    <li key={i} className="flex items-center justify-between text-xs gap-2">
                      <span className={a.ok ? 'text-gain' : 'text-loss'}>
                        {a.ok ? '✓' : '✕'} {a.source}
                      </span>
                      <span className="font-mono text-muted-foreground truncate">{a.note}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function Kpi({
  title,
  value,
  sub,
  tone,
  audit,
}: {
  title: string;
  value: string;
  sub: string;
  tone?: 'gain' | 'loss';
  audit: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <AuditPopover
        title={title}
        trigger={
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
            <p
              className={`mt-1.5 text-xl font-semibold tracking-tight ${
                tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-foreground'
              }`}
            >
              {value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
          </>
        }
      >
        {audit}
      </AuditPopover>
    </div>
  );
}

function AttrCell({ label, pct, strong }: { label: string; pct: number; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${strong ? 'border-foreground/30 bg-secondary/40' : 'border-border bg-secondary/20'}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tracking-tight ${pct >= 0 ? 'text-gain' : 'text-loss'}`}>
        {pct >= 0 ? '+' : ''}
        {pct.toFixed(2)}%
      </p>
    </div>
  );
}

const DollarAdjustedReturns = () => (
  <PrivacyProvider>
    <Content />
  </PrivacyProvider>
);

export default DollarAdjustedReturns;
