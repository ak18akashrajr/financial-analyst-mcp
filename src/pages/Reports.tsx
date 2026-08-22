import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, Save, Printer, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Sparkles, AlertTriangle, Compass, Activity, Wand2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import {
  buildPeriods, periodStatus, buildSnapshot, buildActivity, projectPeriod, calendarMonths,
  type PeriodDef, type PeriodType, type NetWorthHistoryRow, type HistoricalPriceMap,
} from '@/lib/periodReports';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AuditPopover, Formula, AuditSection, AuditTable, SourceBadge } from '@/components/AuditPopover';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';
import type { ReactNode } from 'react';
import type { PeriodSnapshot, PeriodActivity } from '@/lib/periodReports';

const FY_START_YEAR = 2026;
const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];

function fmt(n: number, hidden = false) {
  if (hidden) return '••••••';
  if (!Number.isFinite(n)) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

interface PeriodReportRow {
  period_key: string;
  commentary: string | null;
  highlights: string | null;
  risks: string | null;
  outlook: string | null;
}

const ReportsContent = () => {
  const { hidden, toggle } = usePrivacy();
  const { transactions, currentPrices, symbolMetadata, cash, summary, loading } = usePortfolio();

  const [type, setType] = useState<PeriodType>('quarter');
  const [history, setHistory] = useState<NetWorthHistoryRow[]>([]);
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPriceMap>({});
  const [reports, setReports] = useState<Record<string, PeriodReportRow>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<PeriodReportRow>>>({});
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingBenchmark, setBackfillingBenchmark] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  // Page rows in batches — Supabase caps a single response at 1,000 rows.
  const fetchAllHistoricalPrices = async () => {
    const pageSize = 1000;
    let from = 0;
    const all: Array<{ symbol: string; date: string; close: number }> = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from('historical_prices')
        .select('symbol,date,close')
        .order('date', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as any[]) all.push({ symbol: r.symbol, date: r.date as string, close: Number(r.close) });
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const reloadHistoricalPrices = async () => {
    try {
      const rows = await fetchAllHistoricalPrices();
      const map: HistoricalPriceMap = {};
      for (const r of rows) (map[r.symbol] ||= []).push({ date: r.date, close: r.close });
      setHistoricalPrices(map);
    } catch (e: any) {
      toast.error(`Failed to load historical prices: ${e?.message ?? e}`);
    }
  };

  const backfillFY = async () => {
    const symbols = Array.from(new Set(transactions.map(t => t.symbol)));
    if (symbols.length === 0) { toast.error('No symbols to backfill'); return; }
    setBackfilling(true);
    const t = toast.loading(`Backfilling ${symbols.length} symbols for FY26-27…`);
    try {
      // Daily interval, 2y range covers FY26-27 fully
      const { error } = await supabase.functions.invoke('fetch-historical-prices', {
        body: { symbols, range: '2y', interval: '1d' },
      });
      if (error) throw error;
      await reloadHistoricalPrices();
      toast.success(`Backfilled ${symbols.length} symbols`, { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfilling(false);
    }
  };

  // Populates public.benchmark_history (see fetch-benchmark-prices) so the
  // MCP compare_to_benchmark / get_risk_metrics tools have data to read.
  const backfillBenchmark = async () => {
    setBackfillingBenchmark(true);
    const t = toast.loading('Backfilling benchmark data…');
    try {
      const { data, error } = await supabase.functions.invoke('fetch-benchmark-prices', {
        body: { symbols: ['NIFTY50'], range: '2y', interval: '1d' },
      });
      if (error) throw error;
      const failed = Object.entries(data?.benchmarks ?? {}).filter(([, v]: [string, any]) => v?.error);
      if (failed.length > 0) throw new Error(failed.map(([sym, v]: [string, any]) => `${sym}: ${v.error}`).join('; '));
      toast.success('Backfilled benchmark data', { id: t });
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setBackfillingBenchmark(false);
    }
  };

  // Monthly SIP target (same key as SIPSummary)
  const monthlySIPTarget = useMemo(() => {
    const v = Number(localStorage.getItem('sip_monthly_target') || '0');
    return Number.isFinite(v) ? v : 0;
  }, []);

  // Load net worth history + saved period reports + historical prices
  useEffect(() => {
    (async () => {
      const [hRes, rRes] = await Promise.all([
        supabase.from('net_worth_history').select('*').order('recorded_at', { ascending: true }),
        supabase.from('period_reports' as any).select('*'),
      ]);
      if (hRes.data) setHistory(hRes.data as any);
      if (rRes.data) {
        const map: Record<string, PeriodReportRow> = {};
        for (const r of rRes.data as any[]) map[r.period_key] = r;
        setReports(map);
      }
      await reloadHistoricalPrices();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periods = useMemo(() => buildPeriods(FY_START_YEAR, type), [type]);
  const symbolMetaLite = useMemo(() => {
    const m: Record<string, { geography?: string; category?: string }> = {};
    for (const [s, v] of Object.entries(symbolMetadata)) m[s] = { geography: (v as any).geography, category: (v as any).category };
    return m;
  }, [symbolMetadata]);

  // Default active period: first in-progress, else most recent completed, else first
  useEffect(() => {
    if (activeKey && periods.find(p => p.key === activeKey)) return;
    const now = new Date();
    const inProg = periods.find(p => periodStatus(p, now) === 'in-progress');
    const completed = [...periods].reverse().find(p => periodStatus(p, now) === 'completed');
    setActiveKey((inProg || completed || periods[0])?.key ?? null);
  }, [periods, activeKey]);

  const active = periods.find(p => p.key === activeKey) ?? periods[0];
  const status = active ? periodStatus(active) : 'upcoming';

  // Build snapshots at period start & end.
  //  - start snapshot: always a past point → useLive=false (historical close, else cost).
  //  - end snapshot:   live only when period is in-progress; otherwise historical.
  const fallbackDate = useMemo(() => new Date(), []);
  const startDate = active?.start ?? fallbackDate;
  const endAsOf = !active ? fallbackDate : (status === 'upcoming' ? active.start : (status === 'in-progress' ? new Date() : active.end));
  const startSnap = useMemo(
    () => buildSnapshot(startDate, transactions, currentPrices, symbolMetaLite, history, cash, { historicalPrices, useLive: false }),
    [startDate, transactions, currentPrices, symbolMetaLite, history, cash, historicalPrices],
  );
  const endSnap = useMemo(
    () => buildSnapshot(endAsOf, transactions, currentPrices, symbolMetaLite, history, cash, { historicalPrices, useLive: status === 'in-progress' }),
    [endAsOf, transactions, currentPrices, symbolMetaLite, history, cash, historicalPrices, status],
  );
  const activity = useMemo(() => active ? buildActivity(active, transactions, endSnap) : { buyCount:0, sellCount:0, buyValue:0, sellValue:0, netInvested:0, uniqueSymbols:0, gainers:[], losers:[], sipInvested:0 }, [active, transactions, endSnap]);

  // Projection for upcoming periods (or partial in-progress: project the remainder)
  const projection = useMemo(() => {
    if (!active || status === 'completed') return null;
    const start = status === 'in-progress' ? new Date() : active.start;
    const startVal = status === 'in-progress' ? endSnap.netWorth : startSnap.netWorth;
    return projectPeriod(startVal, monthlySIPTarget, start, active.end, summary.xirr, 12);
  }, [active, status, startSnap, endSnap, monthlySIPTarget, summary.xirr]);

  // QoQ / period-over-period growth. Prev period is by definition completed → useLive=false.
  const periodOverPeriod = useMemo(() => {
    if (!active) return null;
    const idx = periods.findIndex(p => p.key === active.key);
    if (idx <= 0) return null;
    const prev = periods[idx - 1];
    const prevSt = periodStatus(prev);
    const prevEnd = prevSt === 'upcoming' ? prev.start : prev.end;
    const prevSnap = buildSnapshot(prevEnd, transactions, currentPrices, symbolMetaLite, history, cash, { historicalPrices, useLive: false });
    const delta = endSnap.netWorth - prevSnap.netWorth;
    const pct = prevSnap.netWorth > 0 ? (delta / prevSnap.netWorth) * 100 : 0;
    return { prevLabel: prev.shortLabel, prevValue: prevSnap.netWorth, delta, pct };
  }, [periods, active, transactions, currentPrices, symbolMetaLite, history, cash, endSnap, historicalPrices]);

  // Net worth trend across this FY. Each period uses historical mark unless that period is in-progress.
  const trend = useMemo(() => {
    return periods.map(p => {
      const st = periodStatus(p);
      const asOf = st === 'upcoming' ? p.start : (st === 'in-progress' ? new Date() : p.end);
      const snap = buildSnapshot(asOf, transactions, currentPrices, symbolMetaLite, history, cash, { historicalPrices, useLive: st === 'in-progress' });
      return {
        label: p.shortLabel,
        status: st,
        invested: Math.round(snap.invested),
        current: Math.round(snap.currentValue),
        netWorth: Math.round(snap.netWorth),
        pnl: Math.round(snap.pnl),
      };
    });
  }, [periods, transactions, currentPrices, symbolMetaLite, history, cash, historicalPrices]);

  const { selection: trendRangeSelection, handlers: trendRangeHandlers, clear: clearTrendRange } = useChartRangeSelection();
  const trendRangeResult =
    trendRangeSelection.startIndex !== null && trendRangeSelection.endIndex !== null
      ? computeRangeReturn(trend, trendRangeSelection.startIndex, trendRangeSelection.endIndex, 'netWorth', 'label')
      : null;

  if (!active || loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading reports…</div>;
  }

  // Editable narrative
  const merged: PeriodReportRow = {
    period_key: active.key,
    commentary: edits[active.key]?.commentary ?? reports[active.key]?.commentary ?? '',
    highlights: edits[active.key]?.highlights ?? reports[active.key]?.highlights ?? '',
    risks:      edits[active.key]?.risks      ?? reports[active.key]?.risks      ?? '',
    outlook:    edits[active.key]?.outlook    ?? reports[active.key]?.outlook    ?? '',
  };
  const setField = (k: keyof PeriodReportRow, v: string) =>
    setEdits(e => ({ ...e, [active.key]: { ...e[active.key], [k]: v } }));

  const saveNarrative = async () => {
    setSaving(true);
    const payload = {
      period_key: active.key,
      period_type: active.type,
      fy: active.fy,
      commentary: merged.commentary,
      highlights: merged.highlights,
      risks: merged.risks,
      outlook: merged.outlook,
    };
    const { error } = await supabase.from('period_reports' as any).upsert(payload, { onConflict: 'period_key' });
    setSaving(false);
    if (error) { toast.error('Failed to save'); return; }
    setReports(r => ({ ...r, [active.key]: payload as any }));
    setEdits(e => { const c = { ...e }; delete c[active.key]; return c; });
    toast.success('Report narrative saved');
  };

  const generateAINarrative = async () => {
    setGeneratingAI(true);
    const t = toast.loading('Drafting AI narrative for ' + active.label + '…');
    try {
      const prompt = `Generate a board-style earnings narrative for **${active.label}** (${active.fy}, status: ${status}).

PERIOD-END DATA:
- AUM: ₹${Math.round(endSnap.netWorth).toLocaleString('en-IN')} (${periodOverPeriod ? `${periodOverPeriod.pct >= 0 ? '+' : ''}${periodOverPeriod.pct.toFixed(2)}% vs ${periodOverPeriod.prevLabel}` : 'first period'})
- Principal Capital Allocated: ₹${Math.round(endSnap.invested).toLocaleString('en-IN')}
- Current Value: ₹${Math.round(endSnap.currentValue).toLocaleString('en-IN')}
- Unrealized P&L: ₹${Math.round(endSnap.pnl).toLocaleString('en-IN')} (${endSnap.pnlPercent.toFixed(2)}%)
- Holdings: ${endSnap.holdings.length}
- Buy txns: ${activity.buyCount}, Sell txns: ${activity.sellCount}, Capital deployed: ₹${Math.round(activity.buyValue).toLocaleString('en-IN')}
- Top Gainers: ${activity.gainers.map(h => `${h.symbol} (${h.pnlPercent.toFixed(1)}%)`).join(', ') || 'none'}
- Top Losers: ${activity.losers.map(h => `${h.symbol} (${h.pnlPercent.toFixed(1)}%)`).join(', ') || 'none'}
${projection ? `- Projection: base ₹${Math.round(projection.baseEndValue).toLocaleString('en-IN')}, conservative ₹${Math.round(projection.conservativeEndValue).toLocaleString('en-IN')}` : ''}

Respond in EXACTLY this format with these four markdown headers (no preamble, no closing remarks):

## EXECUTIVE SUMMARY
One concise paragraph (3-4 sentences) summarising the period.

## HIGHLIGHTS
3-5 bullet points of wins, milestones, or notable decisions.

## RISKS
3-5 bullet points naming concentration, drawdowns, or watchlist items with specific symbols/%.

## OUTLOOK
2-4 sentences on allocation plan, SIP changes, or deployment targets for next period.`;

      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portfolio-ai`;
      // Send the logged-in user's own session token, not the public anon
      // key — portfolio-ai verifies this server-side and rejects
      // unauthenticated callers (see supabase/functions/_shared/auth.ts).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session has expired — please sign in again.');
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
      if (resp.status === 429) throw new Error('Rate limited — try again shortly.');
      if (resp.status === 402) throw new Error('AI credits exhausted.');
      if (!resp.ok || !resp.body) throw new Error('AI request failed');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') continue;
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) full += c;
          } catch { /* skip */ }
        }
      }

      // Strip model-tag footer if present
      const cleaned = full.replace(/\n*---\n\*.+?Response by.+/s, '').trim();

      const extract = (header: string) => {
        const re = new RegExp(`##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
        const m = cleaned.match(re);
        return m ? m[1].trim() : '';
      };
      const commentary = extract('EXECUTIVE SUMMARY');
      const highlights = extract('HIGHLIGHTS');
      const risks = extract('RISKS');
      const outlook = extract('OUTLOOK');

      if (!commentary && !highlights && !risks && !outlook) {
        // fall back: dump whole response into commentary
        setEdits(e => ({ ...e, [active.key]: { ...e[active.key], commentary: cleaned } }));
      } else {
        setEdits(e => ({ ...e, [active.key]: { ...e[active.key], commentary, highlights, risks, outlook } }));
      }
      toast.success('AI narrative drafted — review & save', { id: t });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to draft narrative', { id: t });
    } finally {
      setGeneratingAI(false);
    }
  };

  const print = () => window.print();

  // ── Audits: pre-built explanation nodes for every KPI on the page ──
  const audits = buildAudits({
    endSnap,
    startSnap,
    activity,
    active,
    status,
    projection,
    monthlySIPTarget,
    periodOverPeriod,
    transactions,
    hidden,
    xirr: summary.xirr,
  });


  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5 print:py-2">
        {/* Header */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></Link>
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Periodic Reports</h1>
              <p className="text-xs text-muted-foreground">{active.fy} · Board-style earnings & projection reports</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={toggle} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground">
              {hidden ? 'Show' : 'Hide'} numbers
            </button>
            <button onClick={backfillFY} disabled={backfilling} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> {backfilling ? 'Backfilling…' : 'Backfill FY26-27 prices'}
            </button>
            <button onClick={backfillBenchmark} disabled={backfillingBenchmark} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> {backfillingBenchmark ? 'Backfilling…' : 'Backfill benchmark data'}
            </button>
            <button onClick={generateAINarrative} disabled={generatingAI} className="text-xs px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" /> {generatingAI ? 'Drafting…' : 'AI Narrative'}
            </button>
            <button onClick={print} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
          </div>
        </div>

        {/* Type toggle */}
        <div className="flex items-center gap-2 print:hidden">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {(['quarter', 'half', 'year'] as PeriodType[]).map(t => (
              <button key={t} onClick={() => setType(t)} className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition ${type === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
                {t === 'quarter' ? 'Quarterly' : t === 'half' ? 'Half-Yearly' : 'Yearly'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 ml-2">
            {periods.map(p => {
              const st = periodStatus(p);
              const isActive = p.key === active.key;
              return (
                <button key={p.key} onClick={() => setActiveKey(p.key)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition ${isActive ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
                  {p.shortLabel}
                  <span className={`ml-1.5 text-[10px] ${isActive ? 'opacity-70' : ''}`}>
                    {st === 'completed' ? '✓' : st === 'in-progress' ? '●' : '○'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Report Cover */}
        <div className="rounded-2xl border border-border bg-card p-6 print:p-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Earnings Report · {active.fy}</p>
              <h2 className="text-2xl font-bold text-foreground mt-1">{active.label}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Period: {active.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} → {new Date(active.end.getTime() - 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
              status === 'completed' ? 'border-green-500/30 text-green-600 bg-green-500/10'
              : status === 'in-progress' ? 'border-amber-500/30 text-amber-600 bg-amber-500/10'
              : 'border-blue-500/30 text-blue-600 bg-blue-500/10'}`}>
              {status === 'completed' ? 'Completed · Actuals' : status === 'in-progress' ? 'In Progress · MTD' : 'Upcoming · Projection'}
            </span>
          </div>

          {/* Auditor data-integrity strip */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            <AuditChip label="Price source" value={
              status === 'in-progress'
                ? `Live ${endSnap.priceSourceCounts.live} · Hist ${endSnap.priceSourceCounts.historical} · Cost ${endSnap.priceSourceCounts.costFallback}`
                : `Hist ${endSnap.priceSourceCounts.historical} · Cost ${endSnap.priceSourceCounts.costFallback}`
            } warn={endSnap.priceSourceCounts.costFallback > 0 || endSnap.priceSourceCounts.none > 0} />
            <AuditChip label="Cash source" value={endSnap.cashSource === 'history' ? 'Net-worth snapshot' : endSnap.cashSource === 'live' ? 'Live (in-progress)' : 'No snapshot → ₹0'} warn={endSnap.cashSource === 'none'} />
            <AuditChip label="Holdings marked" value={`${endSnap.holdings.length}`} />
            <AuditChip label="Txns ≤ period end" value={`${endSnap.holdings.reduce((s, h) => s + h.transactions.length, 0)}`} />
          </div>
        </div>

        {/* Data-staleness warning — surfaced prominently, not just the small chip above,
            because a holding marked at cost silently shows 0% return everywhere below
            (KPIs, trend, Top Movers) with no other visual cue. */}
        {(endSnap.priceSourceCounts.costFallback > 0 || endSnap.priceSourceCounts.none > 0) && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3 print:hidden">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {endSnap.priceSourceCounts.costFallback + endSnap.priceSourceCounts.none} of {endSnap.holdings.length} holding{endSnap.holdings.length === 1 ? '' : 's'} {status === 'in-progress' ? '' : 'as of this period-end '}
                {(endSnap.priceSourceCounts.costFallback + endSnap.priceSourceCounts.none) === 1 ? 'is' : 'are'} marked at cost, not a real price
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                No historical close was found for {(endSnap.priceSourceCounts.costFallback + endSnap.priceSourceCounts.none) === 1 ? 'it' : 'them'} at or before this date, so unrealized P&amp;L on {(endSnap.priceSourceCounts.costFallback + endSnap.priceSourceCounts.none) === 1 ? 'it shows' : 'them show'} as flat 0% below instead of the real return — this can understate AUM, P&amp;L, and Top Movers for the whole period. Run a price backfill to fix it.
              </p>
            </div>
            <button onClick={backfillFY} disabled={backfilling} className="text-xs px-3 py-1.5 rounded-md border border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap flex-shrink-0">
              {backfilling ? 'Backfilling…' : 'Backfill now'}
            </button>
          </div>
        )}

        {endSnap.cashSource === 'none' && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3 print:hidden">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No net-worth snapshot exists at or before this date</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                Operating Cash, Cash Reserve, PF, and Liabilities are all shown as ₹0 for this period by design — the app never blends today's cash into a past period. AUM below is therefore holdings-only until a snapshot exists.
              </p>
            </div>
          </div>
        )}

        {/* Executive KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="AUM" value={fmt(endSnap.netWorth, hidden)} sub={periodOverPeriod ? `${fmtPct(periodOverPeriod.pct)} vs ${periodOverPeriod.prevLabel}` : 'First period'} positive={(periodOverPeriod?.delta ?? 0) >= 0} audit={audits.aum} />
          <KPI label="Principal Capital Allocated" value={fmt(endSnap.invested, hidden)} sub={`Portfolio cost basis`} audit={audits.invested} />
          <KPI label="Current Value" value={fmt(endSnap.currentValue, hidden)} sub={`${endSnap.holdings.length} holdings`} audit={audits.currentValue} />
          <KPI label="Unrealized P&L" value={fmt(endSnap.pnl, hidden)} sub={fmtPct(endSnap.pnlPercent)} positive={endSnap.pnl >= 0} audit={audits.pnl} />
        </div>

        {/* Projection panel (upcoming or in-progress) */}
        {projection && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Compass className="w-4 h-4 text-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                {status === 'upcoming' ? 'Forward Projection' : 'Period-End Projection (remaining months)'}
              </h3>
              <span className="ml-auto text-[10px] text-muted-foreground">XIRR {(projection.baseRate * 100).toFixed(2)}% · Conservative {(projection.conservativeRate * 100).toFixed(2)}% · SIP ₹{monthlySIPTarget.toLocaleString('en-IN')}/mo · {projection.monthsAhead} mo</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <AuditPopover title="Base Case Projection" trigger={
                <div className="rounded-xl border border-border p-4 bg-secondary/30 text-left cursor-help hover:border-foreground/40 transition-colors w-full">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Base Case (current XIRR) · click to audit</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{fmt(projection.baseEndValue, hidden)}</p>
                  <p className="text-xs text-green-600 mt-1">Projected AUM at period end</p>
                </div>
              }>{audits.projectionBase}</AuditPopover>
              <AuditPopover title="Conservative Projection" trigger={
                <div className="rounded-xl border border-border p-4 bg-secondary/30 text-left cursor-help hover:border-foreground/40 transition-colors w-full">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Conservative (XIRR × 0.8) · click to audit</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{fmt(projection.conservativeEndValue, hidden)}</p>
                  <p className="text-xs text-amber-600 mt-1">Downside scenario</p>
                </div>
              }>{audits.projectionConservative}</AuditPopover>
            </div>
          </div>
        )}

        {/* Performance trend across FY */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Performance Trend · {active.fy}</h3>
          <div className="h-72 relative">
            <ResponsiveContainer>
              <LineChart data={trend} {...trendRangeHandlers}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt(Number(v), hidden)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ChartRangeReferenceArea selection={trendRangeSelection} data={trend} labelKey="label" />
                <Line type="monotone" dataKey="invested" stroke="#64748b" strokeWidth={2} dot={false} name="Principal Capital Allocated" />
                <Line type="monotone" dataKey="current" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} name="Current" />
                <Line type="monotone" dataKey="netWorth" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="AUM" />
              </LineChart>
            </ResponsiveContainer>
            <ChartRangeBadge
              selection={trendRangeSelection}
              result={trendRangeResult}
              onClear={clearTrendRange}
              unit="currency"
              formatValue={(v) => fmt(v, false)}
              valueLabel="AUM"
            />
          </div>
        </div>

        {/* P&L per period bar */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Unrealized P&L by Period</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt(Number(v), hidden)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Bar dataKey="pnl" name="P&L">
                  {trend.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Exposure breakdown */}
        <div className="grid md:grid-cols-2 gap-3">
          <ExposurePie title="Category Exposure (period-end)" data={endSnap.categoryExposure} hidden={hidden} />
          <ExposurePie title="Geography Exposure (period-end)" data={endSnap.geographyExposure} hidden={hidden} />
        </div>

        {/* Activity + Top movers */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-card p-5 md:col-span-1">
            <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4" /><h3 className="text-sm font-semibold">Activity in Period</h3></div>
            <div className="space-y-2 text-sm">
              <Row label="Buy transactions" value={`${activity.buyCount}`} audit={audits.buyCount} />
              <Row label="Sell transactions" value={`${activity.sellCount}`} audit={audits.sellCount} />
              <Row label="Capital deployed" value={fmt(activity.buyValue, hidden)} audit={audits.buyValue} />
              <Row label="Capital withdrawn" value={fmt(activity.sellValue, hidden)} audit={audits.sellValue} />
              <Row label="Net invested" value={fmt(activity.netInvested, hidden)} accent={activity.netInvested >= 0} audit={audits.netInvested} />
              <Row label="Unique symbols touched" value={`${activity.uniqueSymbols}`} audit={audits.uniqueSymbols} />
              {monthlySIPTarget > 0 && (
                <Row label="SIP adherence" value={`${Math.min(999, Math.round((activity.sipInvested / (monthlySIPTarget * calendarMonths(active.start, status === 'in-progress' ? new Date() : active.end))) * 100))}%`} audit={audits.sipAdherence} />
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2">
            <h3 className="text-sm font-semibold mb-3">Top Movers (period-end)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-green-600 mb-2 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Gainers</p>
                <div className="space-y-1.5">
                  {activity.gainers.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
                  {activity.gainers.map(h => (
                    <AuditPopover key={h.symbol} title={`${h.symbol} · Return`} trigger={
                      <div className="flex items-center justify-between text-xs cursor-help hover:bg-secondary/40 -mx-1 px-1 rounded transition-colors">
                        <span className="font-medium">{h.symbol}</span>
                        <span className="text-green-600 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />{fmtPct(h.pnlPercent)}</span>
                      </div>
                    }>{holdingAudit(h, endSnap, hidden)}</AuditPopover>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Losers</p>
                <div className="space-y-1.5">
                  {activity.losers.length === 0 && <p className="text-xs text-muted-foreground">No losers — clean period 🎯</p>}
                  {activity.losers.map(h => (
                    <AuditPopover key={h.symbol} title={`${h.symbol} · Return`} trigger={
                      <div className="flex items-center justify-between text-xs cursor-help hover:bg-secondary/40 -mx-1 px-1 rounded transition-colors">
                        <span className="font-medium">{h.symbol}</span>
                        <span className="text-red-600 flex items-center gap-1"><ArrowDownRight className="w-3 h-3" />{fmtPct(h.pnlPercent)}</span>
                      </div>
                    }>{holdingAudit(h, endSnap, hidden)}</AuditPopover>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cash composition */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Liquidity & Reserves (period-end)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Operating Cash" value={fmt(endSnap.liquidCash, hidden)} audit={audits.operatingCash} />
            <KPI label="Cash Reserve" value={fmt(endSnap.vaultCash, hidden)} audit={audits.cashReserve} />
            <KPI label="PF (PPF/EPF)" value={fmt(endSnap.pfBalance, hidden)} audit={audits.pfBalance} />
            <KPI label="Outstanding Liabilities" value={fmt(endSnap.creditCardDebt, hidden)} positive={endSnap.creditCardDebt === 0} audit={audits.liabilities} />
          </div>
        </div>

        {/* Narrative editor */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" /> Board Commentary</h3>
            <button onClick={saveNarrative} disabled={saving} className="text-xs px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Narrative'}
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <NarrativeBlock label="Executive Summary" placeholder="Open the report with a one-paragraph summary…" value={merged.commentary || ''} onChange={v => setField('commentary', v)} />
            <NarrativeBlock label="Highlights" icon={<Sparkles className="w-3.5 h-3.5 text-green-600" />} placeholder="Wins this period — biggest gainers, milestones, decisions…" value={merged.highlights || ''} onChange={v => setField('highlights', v)} />
            <NarrativeBlock label="Risks & Watchlist" icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-600" />} placeholder="Concentration, drawdowns, macro risk, debt creep…" value={merged.risks || ''} onChange={v => setField('risks', v)} />
            <NarrativeBlock label="Outlook · Next Period" icon={<Compass className="w-3.5 h-3.5 text-blue-600" />} placeholder="Allocation plan, SIP changes, deployment targets…" value={merged.outlook || ''} onChange={v => setField('outlook', v)} />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground text-center pt-2 print:hidden">
          Actuals computed from transactions + net-worth history. Projections use XIRR {summary.xirr ? `(${(summary.xirr * 100).toFixed(2)}%)` : '(12% fallback)'} compounded monthly with your SIP target.
        </p>
      </div>
    </div>
  );
};

const AuditChip = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div className={`rounded-md border px-2 py-1.5 ${warn ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-secondary/20'}`}>
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`font-mono mt-0.5 ${warn ? 'text-amber-600' : 'text-foreground'}`}>{value}</p>
  </div>
);

const KPI = ({ label, value, sub, positive, audit }: { label: string; value: string; sub?: string; positive?: boolean; audit?: ReactNode }) => {
  const body = (
    <div className={`rounded-xl border border-border bg-card p-4 ${audit ? 'hover:border-foreground/40 transition-colors' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {audit && <span className="text-[8px] text-muted-foreground/60">·</span>}
        {audit && <span className="text-[9px] text-muted-foreground/60 font-normal normal-case tracking-normal">click to audit</span>}
      </p>
      <p className="text-lg font-bold text-foreground mt-1 font-mono">{value}</p>
      {sub && <p className={`text-[11px] mt-1 ${positive === true ? 'text-green-600' : positive === false ? 'text-red-600' : 'text-muted-foreground'}`}>{sub}</p>}
    </div>
  );
  if (!audit) return body;
  return <AuditPopover title={label} trigger={body}>{audit}</AuditPopover>;
};

const Row = ({ label, value, accent, audit }: { label: string; value: string; accent?: boolean; audit?: ReactNode }) => {
  const body = (
    <div className={`flex items-center justify-between text-xs ${audit ? 'hover:bg-secondary/40 -mx-1 px-1 rounded transition-colors' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium ${accent === true ? 'text-green-600' : accent === false ? 'text-red-600' : 'text-foreground'}`}>{value}</span>
    </div>
  );
  if (!audit) return body;
  return <AuditPopover title={label} trigger={body}>{audit}</AuditPopover>;
};

const ExposurePie = ({ title, data, hidden }: { title: string; data: { label: string; value: number; percent: number }[]; hidden: boolean }) => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <h3 className="text-sm font-semibold mb-3">{title}</h3>
    {data.length === 0 ? <p className="text-xs text-muted-foreground">No data</p> : (
      <div className="h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={40} outerRadius={75} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: any, _n, p: any) => [`${fmt(Number(v), hidden)} (${p.payload.percent.toFixed(1)}%)`, p.payload.label]} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

const NarrativeBlock = ({ label, value, onChange, placeholder, icon }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; icon?: React.ReactNode }) => (
  <div>
    <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">{icon}{label}</label>
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={5}
      className="w-full text-xs bg-background border border-border rounded-md p-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground" />
  </div>
);

const Reports = () => (
  <PrivacyProvider>
    <ReportsContent />
  </PrivacyProvider>
);
export default Reports;

// ─────────────────────────────────────────────────────────────────────────────
// Audit content builders — every KPI on the page traces back to its source
// ─────────────────────────────────────────────────────────────────────────────
import type { DerivedHolding, Transaction } from '@/types/portfolio';

const asOfLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function holdingAudit(h: DerivedHolding, endSnap: PeriodSnapshot, hidden: boolean): ReactNode {
  const src = endSnap.priceSources[h.symbol] ?? 'none';
  const priceDate = endSnap.priceDates[h.symbol];
  return (
    <>
      <AuditSection label="Formula">
        <Formula>
          Return % = (currentPrice − avgCost) ÷ avgCost × 100<br />
          P&amp;L = (currentPrice − avgCost) × qty
        </Formula>
      </AuditSection>
      <AuditSection label="Inputs">
        <AuditTable
          headers={['Field', 'Value']}
          rows={[
            ['Quantity held', h.totalQuantity.toFixed(4)],
            ['Avg cost', fmt(h.avgPrice, hidden)],
            ['Mark price', fmt(h.currentPrice, hidden)],
            ['Price source', <SourceBadge source={src} />],
            ['As of', priceDate ?? asOfLabel(endSnap.asOf)],
            ['Total invested', fmt(h.totalInvested, hidden)],
            ['Current value', fmt(h.currentValue, hidden)],
            ['P&L', fmt(h.pnl, hidden)],
            ['Return %', `${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent.toFixed(2)}%`],
          ]}
        />
      </AuditSection>
    </>
  );
}

interface BuildAuditsArgs {
  endSnap: PeriodSnapshot;
  startSnap: PeriodSnapshot;
  activity: PeriodActivity;
  active: PeriodDef;
  status: 'completed' | 'in-progress' | 'upcoming';
  projection: { baseEndValue: number; conservativeEndValue: number; baseRate: number; conservativeRate: number; monthsAhead: number } | null;
  monthlySIPTarget: number;
  periodOverPeriod: { prevLabel: string; prevValue: number; delta: number; pct: number } | null;
  transactions: Transaction[];
  hidden: boolean;
  xirr: number | null;
}

function buildAudits(a: BuildAuditsArgs) {
  const { endSnap, startSnap, activity, active, status, projection, monthlySIPTarget, periodOverPeriod, transactions, hidden } = a;
  const periodTxns = transactions.filter(t => {
    const d = new Date(t.date);
    return d >= active.start && d < active.end;
  });
  const asOf = asOfLabel(endSnap.asOf);
  const cashSourceLabel: Record<PeriodSnapshot['cashSource'], ReactNode> = {
    history: <SourceBadge source="snapshot" />,
    live: <SourceBadge source="live" />,
    none: <SourceBadge source="none" />,
  };

  // Holdings mark table (used by AUM, Current, P&L, Invested)
  const holdingsTable = (
    <AuditTable
      headers={['Symbol', 'Qty', 'Avg', 'Mark', 'Value', 'Src']}
      rows={endSnap.holdings.map(h => [
        h.symbol,
        h.totalQuantity.toFixed(2),
        fmt(h.avgPrice, hidden),
        fmt(h.currentPrice, hidden),
        fmt(h.currentValue, hidden),
        <SourceBadge source={endSnap.priceSources[h.symbol] ?? 'none'} />,
      ])}
      footer={['Total', '', '', '', fmt(endSnap.currentValue, hidden), '']}
    />
  );

  const investedTable = (
    <AuditTable
      headers={['Symbol', 'Qty', 'Avg cost', 'Invested']}
      rows={endSnap.holdings.map(h => [
        h.symbol,
        h.totalQuantity.toFixed(4),
        fmt(h.avgPrice, hidden),
        fmt(h.totalInvested, hidden),
      ])}
      footer={['Total', '', '', fmt(endSnap.invested, hidden)]}
    />
  );

  const buyTxns = periodTxns.filter(t => t.type === 'BUY');
  const sellTxns = periodTxns.filter(t => t.type === 'SELL');

  const txnTable = (rows: Transaction[]) => (
    <AuditTable
      headers={['Date', 'Symbol', 'Qty', 'Price', 'Value']}
      rows={rows.slice(0, 30).map(t => [
        new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        t.symbol,
        t.quantity.toFixed(4),
        fmt(t.price, hidden),
        fmt(t.quantity * t.price, hidden),
      ])}
      footer={rows.length > 0 ? ['Total', `${rows.length} txn${rows.length === 1 ? '' : 's'}`, '', '', fmt(rows.reduce((s, t) => s + t.quantity * t.price, 0), hidden)] : undefined}
    />
  );

  return {
    aum: (
      <>
        <AuditSection label="Formula">
          <Formula>AUM = Current Value + Operating Cash + Cash Reserve + PF − Outstanding Liabilities</Formula>
        </AuditSection>
        <AuditSection label={`Inputs · as of ${asOf}`}>
          <AuditTable
            headers={['Component', 'Value']}
            rows={[
              ['Current Value (holdings)', fmt(endSnap.currentValue, hidden)],
              ['+ Operating Cash', fmt(endSnap.liquidCash, hidden)],
              ['+ Cash Reserve', fmt(endSnap.vaultCash, hidden)],
              ['+ PF (PPF/EPF)', fmt(endSnap.pfBalance, hidden)],
              ['− Outstanding Liabilities', fmt(endSnap.creditCardDebt, hidden)],
              ['Cash source', cashSourceLabel[endSnap.cashSource]],
            ]}
            footer={['= AUM', fmt(endSnap.netWorth, hidden)]}
          />
        </AuditSection>
        {periodOverPeriod && (
          <AuditSection label="Period-over-period Δ">
            <Formula>
              Δ = AUM<sub>current</sub> − AUM<sub>{periodOverPeriod.prevLabel}</sub><br />
              % = Δ ÷ AUM<sub>{periodOverPeriod.prevLabel}</sub> × 100
            </Formula>
            <div className="mt-1.5">
              <AuditTable
                headers={['Field', 'Value']}
                rows={[
                  [`Prev (${periodOverPeriod.prevLabel})`, fmt(periodOverPeriod.prevValue, hidden)],
                  ['Current', fmt(endSnap.netWorth, hidden)],
                  ['Δ', fmt(periodOverPeriod.delta, hidden)],
                  ['%', `${periodOverPeriod.pct >= 0 ? '+' : ''}${periodOverPeriod.pct.toFixed(2)}%`],
                ]}
              />
            </div>
          </AuditSection>
        )}
      </>
    ),

    invested: (
      <>
        <AuditSection label="Formula">
          <Formula>Principal Capital Allocated = Σ over each open holding (qty × avg cost)</Formula>
          <p className="text-[10px] text-muted-foreground mt-1">Avg cost = Σ (BUY qty × price) − Σ (SELL qty × price), divided by net qty.</p>
        </AuditSection>
        <AuditSection label={`Per-holding cost basis · txns ≤ ${asOf}`}>{investedTable}</AuditSection>
      </>
    ),

    currentValue: (
      <>
        <AuditSection label="Formula">
          <Formula>Current Value = Σ over each open holding (qty × mark price)</Formula>
          <p className="text-[10px] text-muted-foreground mt-1">
            Mark price rule: {status === 'in-progress' ? 'Live → Historical → Cost' : 'Historical close at-or-before period end → Cost fallback'}.
          </p>
        </AuditSection>
        <AuditSection label={`Per-holding mark · as of ${asOf}`}>{holdingsTable}</AuditSection>
      </>
    ),

    pnl: (
      <>
        <AuditSection label="Formula">
          <Formula>Unrealized P&amp;L = Current Value − Principal Capital Allocated</Formula>
        </AuditSection>
        <AuditSection label="Aggregate">
          <AuditTable
            headers={['Field', 'Value']}
            rows={[
              ['Current Value', fmt(endSnap.currentValue, hidden)],
              ['− Invested', fmt(endSnap.invested, hidden)],
              ['P&L', fmt(endSnap.pnl, hidden)],
              ['P&L %', `${endSnap.pnlPercent >= 0 ? '+' : ''}${endSnap.pnlPercent.toFixed(2)}%`],
            ]}
          />
        </AuditSection>
        <AuditSection label="Per-holding contribution">
          <AuditTable
            headers={['Symbol', 'Invested', 'Value', 'P&L']}
            rows={endSnap.holdings.map(h => [h.symbol, fmt(h.totalInvested, hidden), fmt(h.currentValue, hidden), fmt(h.pnl, hidden)])}
            footer={['Total', fmt(endSnap.invested, hidden), fmt(endSnap.currentValue, hidden), fmt(endSnap.pnl, hidden)]}
          />
        </AuditSection>
      </>
    ),

    projectionBase: projection && (
      <>
        <AuditSection label="Formula">
          <Formula>
            V<sub>0</sub> = start value · r<sub>m</sub> = (1 + r<sub>y</sub>)<sup>1/12</sup> − 1<br />
            For each of n months: V := V·(1 + r<sub>m</sub>) + SIP
          </Formula>
        </AuditSection>
        <AuditSection label="Inputs">
          <AuditTable
            headers={['Field', 'Value']}
            rows={[
              ['Start value (V₀)', fmt(status === 'in-progress' ? endSnap.netWorth : startSnap.netWorth, hidden)],
              ['Annual rate r_y', `${(projection.baseRate * 100).toFixed(2)}%`],
              ['Monthly rate r_m', `${((Math.pow(1 + projection.baseRate, 1 / 12) - 1) * 100).toFixed(3)}%`],
              ['SIP / month', fmt(monthlySIPTarget, hidden)],
              ['Months ahead (n)', `${projection.monthsAhead}`],
              ['Projected end value', fmt(projection.baseEndValue, hidden)],
            ]}
          />
        </AuditSection>
      </>
    ),

    projectionConservative: projection && (
      <>
        <AuditSection label="Formula">
          <Formula>Same monthly compounding with r<sub>y</sub> × 0.8 (haircut).</Formula>
        </AuditSection>
        <AuditSection label="Inputs">
          <AuditTable
            headers={['Field', 'Value']}
            rows={[
              ['Base r_y', `${(projection.baseRate * 100).toFixed(2)}%`],
              ['Conservative r_y (×0.8)', `${(projection.conservativeRate * 100).toFixed(2)}%`],
              ['Monthly rate r_m', `${((Math.pow(1 + projection.conservativeRate, 1 / 12) - 1) * 100).toFixed(3)}%`],
              ['SIP / month', fmt(monthlySIPTarget, hidden)],
              ['Months ahead (n)', `${projection.monthsAhead}`],
              ['Projected end value', fmt(projection.conservativeEndValue, hidden)],
            ]}
          />
        </AuditSection>
      </>
    ),

    buyCount: (
      <AuditSection label={`BUY transactions between ${asOfLabel(active.start)} and ${asOfLabel(active.end)}`}>{txnTable(buyTxns)}</AuditSection>
    ),
    sellCount: (
      <AuditSection label={`SELL transactions in period`}>{sellTxns.length ? txnTable(sellTxns) : <p className="text-[11px] text-muted-foreground">No SELL transactions.</p>}</AuditSection>
    ),
    buyValue: (
      <>
        <AuditSection label="Formula">
          <Formula>Capital deployed = Σ (BUY qty × price) for txns in period</Formula>
        </AuditSection>
        <AuditSection label="Contributing BUYs">{txnTable(buyTxns)}</AuditSection>
      </>
    ),
    sellValue: (
      <>
        <AuditSection label="Formula">
          <Formula>Capital withdrawn = Σ (SELL qty × price) for txns in period</Formula>
        </AuditSection>
        <AuditSection label="Contributing SELLs">{sellTxns.length ? txnTable(sellTxns) : <p className="text-[11px] text-muted-foreground">No SELL transactions.</p>}</AuditSection>
      </>
    ),
    netInvested: (
      <>
        <AuditSection label="Formula">
          <Formula>Net invested = Capital deployed − Capital withdrawn</Formula>
        </AuditSection>
        <AuditSection label="Values">
          <AuditTable
            headers={['Field', 'Value']}
            rows={[
              ['Capital deployed', fmt(activity.buyValue, hidden)],
              ['− Capital withdrawn', fmt(activity.sellValue, hidden)],
              ['= Net invested', fmt(activity.netInvested, hidden)],
            ]}
          />
        </AuditSection>
      </>
    ),
    uniqueSymbols: (
      <AuditSection label={`Distinct symbols traded (${activity.uniqueSymbols})`}>
        <div className="flex flex-wrap gap-1">
          {Array.from(new Set(periodTxns.map(t => t.symbol))).map(s => (
            <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-secondary/40">{s}</span>
          ))}
        </div>
      </AuditSection>
    ),
    sipAdherence: (
      <>
        <AuditSection label="Formula">
          <Formula>
            SIP adherence % = (Σ BUY value in period) ÷ (SIP target × months in period) × 100
          </Formula>
        </AuditSection>
        <AuditSection label="Inputs">
          <AuditTable
            headers={['Field', 'Value']}
            rows={[
              ['SIP target / mo', fmt(monthlySIPTarget, hidden)],
              ['Months in period', `${(status === 'in-progress' ? calendarMonths(active.start, new Date()) : calendarMonths(active.start, active.end))}`],
              ['Expected', fmt(monthlySIPTarget * (status === 'in-progress' ? calendarMonths(active.start, new Date()) : calendarMonths(active.start, active.end)), hidden)],
              ['Actual (Σ BUY)', fmt(activity.sipInvested, hidden)],
            ]}
          />
        </AuditSection>
      </>
    ),

    operatingCash: (
      <AuditSection label="Source">
        <p className="text-[11px] mb-2">
          Manual input, snapshot as of {asOf}. {endSnap.cashSource === 'history' ? 'Read from the nearest net-worth history row at-or-before the period end.' : endSnap.cashSource === 'live' ? 'Live user-entered value (in-progress period).' : 'No snapshot exists at-or-before this date, so the value is 0 by design (no fabrication).'}
        </p>
        <p className="text-[11px] font-mono">Operating Cash = {fmt(endSnap.liquidCash, hidden)}</p>
      </AuditSection>
    ),
    cashReserve: (
      <AuditSection label="Source">
        <p className="text-[11px] mb-2">Manual input. Same net-worth snapshot lookup as Operating Cash.</p>
        <p className="text-[11px] font-mono">Cash Reserve = {fmt(endSnap.vaultCash, hidden)}</p>
      </AuditSection>
    ),
    pfBalance: (
      <AuditSection label="Source">
        <p className="text-[11px] mb-2">Manual input (PPF/EPF balance). Snapshot lookup.</p>
        <p className="text-[11px] font-mono">PF = {fmt(endSnap.pfBalance, hidden)}</p>
      </AuditSection>
    ),
    liabilities: (
      <AuditSection label="Source">
        <p className="text-[11px] mb-2">Manual input (credit-card outstanding). Snapshot lookup.</p>
        <p className="text-[11px] font-mono">Liabilities = {fmt(endSnap.creditCardDebt, hidden)}</p>
      </AuditSection>
    ),
  };
}

