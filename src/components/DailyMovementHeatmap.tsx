import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ChevronDown, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { logClientError } from '@/lib/clientErrorLogging';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { istDayOf } from '@/lib/dateUtils';
import { pickRefreshRange } from '@/lib/dailyPriceRefresh';
import {
  NEUTRAL_BAND_PCT,
  buildDailyMovements,
  fyMonthIdx,
  fyOf,
  summarizeFy,
  summarizeMonths,
  type DayMovement,
  type FySummary,
  type MonthSummary,
} from '@/lib/dailyMovement';
import type { PricesBySymbol } from '@/lib/portfolioSeries';
import type { Transaction } from '@/types/portfolio';
import { fmtInr, fmtSignedInr, tone } from '@/components/NetWorthBridgeTable';
import { AuditSection, AuditTable } from '@/components/AuditPopover';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Card } from '@/components/ui/card';
import { GridSkeleton } from '@/components/PageSkeleton';
import { EmptyState } from '@/components/EmptyState';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const DAYS_1_TO_31 = Array.from({ length: 31 }, (_, i) => i + 1);

const fyLabel = (fy: number) => `FY${String(fy).slice(-2)}-${String(fy + 1).slice(-2)}`;

function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const fmtPct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
const fmtPx = (n: number | null, hidden: boolean) => (hidden ? '••' : n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** Daily cell tint: ±3% saturates. Grey days use the muted token regardless of sign. */
function dayColor(d: DayMovement): string {
  if (d.cls === 'grey') return 'hsl(var(--muted) / 0.6)';
  const t = Math.min(1, Math.abs(d.pct) / 3);
  return d.cls === 'green' ? `hsl(var(--gain) / ${0.2 + t * 0.7})` : `hsl(var(--loss) / ${0.2 + t * 0.7})`;
}

/** Month cell tint from (green − red) ÷ active days. */
function monthColor(s: MonthSummary): string {
  if (s.active === 0) return 'hsl(var(--muted) / 0.3)';
  const t = (s.green - s.red) / s.active;
  if (t === 0) return 'hsl(var(--muted) / 0.6)';
  return t > 0 ? `hsl(var(--gain) / ${0.15 + t * 0.7})` : `hsl(var(--loss) / ${0.15 + -t * 0.7})`;
}

/** Same panel chrome as AuditPopover, opened on hover instead of click. */
function HoverPanel({ title, trigger, triggerLabel, triggerClassName, children }: {
  title: string; trigger: ReactNode; triggerLabel: string; triggerClassName?: string; children: ReactNode;
}) {
  return (
    <HoverCard openDelay={80} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button type="button" aria-label={triggerLabel} className={`cursor-help ${triggerClassName ?? ''}`}>{trigger}</button>
      </HoverCardTrigger>
      <HoverCardContent align="center" className="w-[400px] max-w-[calc(100vw-2rem)] max-h-[480px] overflow-auto p-0">
        <div className="sticky top-0 bg-card border-b border-border px-4 py-2.5 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <div className="px-4 py-3 text-xs text-foreground space-y-3">{children}</div>
      </HoverCardContent>
    </HoverCard>
  );
}

function DayDetail({ d, hidden }: { d: DayMovement; hidden: boolean }) {
  const label = d.cls === 'green' ? 'Profitable day' : d.cls === 'red' ? 'Non-profitable day' : 'Minimal price movement';
  return (
    <>
      <AuditSection label="Result">
        <p className="font-mono text-[11px]">
          <span className={hidden ? '' : tone(d.pnl)}>{fmtPct(d.pct)} · {fmtSignedInr(d.pnl, hidden)}</span>
          {' '}— {label}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          % = (value today − value on {fmtDate(d.prevDate)} − net buys) ÷ value on {fmtDate(d.prevDate)} = ({fmtInr(d.value, hidden)} − {fmtInr(d.prevValue, hidden)} − {fmtSignedInr(d.netFlow, hidden)}) ÷ {fmtInr(d.prevValue, hidden)}
        </p>
      </AuditSection>
      <AuditSection label="What moved (holdings, vs previous trading day)">
        <AuditTable
          headers={['Symbol', 'Close', 'Qty', 'Move']}
          rows={d.moves.map((m) => [
            m.symbol,
            <div key="c" className="space-y-0.5">
              <div>{fmtPx(m.closePrev, hidden)} → {fmtPx(m.close, hidden)}</div>
              {m.closePrev != null && m.close != null && m.closePrev > 0 && (
                <div className={`text-[10px] ${m.close >= m.closePrev ? 'text-gain' : 'text-loss'}`}>
                  {fmtPct(((m.close - m.closePrev) / m.closePrev) * 100)}
                </div>
              )}
            </div>,
            <div key="q" className="space-y-0.5">
              <div>{hidden ? '••' : m.qtyNow}</div>
              {m.netFlow !== 0 && (
                <div className="text-[10px] text-muted-foreground">{hidden ? '••' : `${m.qtyPrev} → ${m.qtyNow}`}</div>
              )}
            </div>,
            <span key="p" className={hidden ? '' : tone(m.pnl)}>{fmtSignedInr(m.pnl, hidden)}</span>,
          ])}
          footer={['Total', '', '', fmtSignedInr(d.pnl, hidden)]}
        />
        {d.netFlow !== 0 && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Net buys/sells dated since {fmtDate(d.prevDate)}: {fmtSignedInr(d.netFlow, hidden)}. They change the value but are removed from the move.
          </p>
        )}
      </AuditSection>
    </>
  );
}

function MonthDetail({ s, hidden }: { s: MonthSummary; hidden: boolean }) {
  return (
    <>
      <p>
        Out of <b>{s.active}</b> active trading days:{' '}
        <b className="text-gain">{s.green}</b> Profitable · <b className="text-loss">{s.red}</b> Non Profitable ·{' '}
        <b>{s.grey}</b> Minimal Price movements.
      </p>
      <p className="font-mono text-[11px]">
        Sum of daily P&amp;L: <span className={hidden ? '' : tone(s.pnl)}>{fmtSignedInr(s.pnl, hidden)}</span>
      </p>
      {!s.final && (
        <p className="text-[10px] text-amber-600">
          Month not closed yet — counts are provisional until its last weekday has passed.
        </p>
      )}
    </>
  );
}

function FyStatement({ s, hidden }: { s: FySummary; hidden: boolean }) {
  const rate = s.profitRatePct.toFixed(1);
  const days = (
    <>
      <b className="text-foreground">{s.green}</b> of <b className="text-foreground">{s.active}</b> active trading days (<b className="text-foreground">{rate}%</b>)
    </>
  );
  const flat = Math.round(Math.abs(s.pnl)) === 0;
  const amount = <b className={hidden ? 'text-foreground' : tone(s.pnl)}>{fmtInr(Math.abs(s.pnl), hidden)}</b>;
  const outcome = flat ? (
    <>net flat ({amount})</>
  ) : s.pnl > 0 ? (
    <>a net profit of {amount}</>
  ) : (
    <>a net loss of {amount}</>
  );
  const label = fyLabel(s.fy);
  const tail = s.final ? '' : ' so far';

  let lead: ReactNode;
  if (s.profitRatePct > 50 && s.pnl < 0 && !flat) {
    lead = <>Even though {days} were profitable, {label}{tail} ended with {outcome}.</>;
  } else if (s.profitRatePct < 50 && s.pnl > 0 && !flat) {
    lead = <>Although only {days} were profitable, {label}{tail} ended with {outcome}.</>;
  } else if (s.profitRatePct < 50) {
    lead = <>Only {days} were profitable in {label}{tail}, with {outcome}.</>;
  } else {
    lead = <>{days} were profitable in {label}{tail}, with {outcome}.</>;
  }

  return (
    <div className="text-xs text-muted-foreground space-y-0.5" data-testid="fy-statement">
      <p>{lead}</p>
      {!s.final && (
        <p className="text-[10px]" data-testid="fy-in-progress">
          {label} is still in progress — figures are as of YTD.
        </p>
      )}
    </div>
  );
}

type PriceRow = { symbol: string; date: string; close: number };

export function DailyMovementHeatmap({ transactions }: { transactions: Transaction[] }) {
  const { hidden } = usePrivacy();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFy, setSelectedFy] = useState<number | null>(null);
  const [showMonths, setShowMonths] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshedFor = useRef<string | null>(null);

  const symbols = useMemo(() => Array.from(new Set(transactions.map((t) => t.symbol))).sort(), [transactions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (symbols.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }
      // Only the first load shows the skeleton; the post-refresh reload swaps data in place.
      if (reloadKey === 0) setLoading(true);
      const { data, error } = await fetchAllPages((from, to) =>
        supabase
          .from('historical_prices')
          .select('symbol,date,close')
          .in('symbol', symbols)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (cancelled) return;
      if (error) logClientError('DailyMovementHeatmap', 'Failed to load historical_prices', { error });
      setRows(((data as any[] | null) ?? []).map((r) => ({ symbol: r.symbol, date: r.date, close: Number(r.close) })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [symbols, reloadKey]);

  // On every visit, top up the stored daily bars from Yahoo (fetch-historical-prices upserts them), then
  // reload. Runs once per symbol set per mount, after the stored rows have loaded so the range can be sized
  // to the gap. A failure leaves the stored data in place and is surfaced as a note, not an empty card.
  useEffect(() => {
    const key = symbols.join(',');
    if (loading || symbols.length === 0 || refreshedFor.current === key) return;
    refreshedFor.current = key;
    const latest: Record<string, string> = {};
    for (const r of rows) if (!latest[r.symbol] || r.date > latest[r.symbol]) latest[r.symbol] = r.date;
    const range = pickRefreshRange(symbols, latest, istDayOf(new Date().toISOString()));
    (async () => {
      setRefreshing(true);
      setRefreshFailed(false);
      try {
        const { error } = await supabase.functions.invoke('fetch-historical-prices', { body: { symbols, range, interval: '1d' } });
        if (error) throw error;
        setReloadKey((k) => k + 1);
      } catch (e: any) {
        logClientError('DailyMovementHeatmap', 'Auto-refresh of daily prices failed', { error: e?.message ?? String(e), symbols, range });
        setRefreshFailed(true);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [loading, symbols, rows]);

  const { days, symbolsWithoutPrices } = useMemo(() => {
    const bySym: PricesBySymbol = {};
    for (const r of rows) (bySym[r.symbol] ||= []).push({ date: r.date, close: r.close });
    return buildDailyMovements(transactions, bySym);
  }, [rows, transactions]);

  const latestBar = useMemo(() => rows.reduce((m, r) => (r.date > m ? r.date : m), ''), [rows]);
  const todayIst = istDayOf(new Date().toISOString());
  const months = useMemo(() => summarizeMonths(days, todayIst), [days, todayIst]);
  const fys = useMemo(() => [...new Set(days.map((d) => fyOf(d.date)))].sort((a, b) => a - b), [days]);
  const activeFy = selectedFy != null && fys.includes(selectedFy) ? selectedFy : fys[fys.length - 1];

  const fySummary = useMemo(() => (activeFy == null ? null : summarizeFy(days, activeFy, todayIst)), [days, activeFy, todayIst]);

  // One lookup: `${monthIdx}-${dayOfMonth}` → DayMovement, for the selected FY.
  const dayCells = useMemo(() => {
    const m = new Map<string, DayMovement>();
    for (const d of days) if (fyOf(d.date) === activeFy) m.set(`${fyMonthIdx(d.date)}-${Number(d.date.slice(8, 10))}`, d);
    return m;
  }, [days, activeFy]);

  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Daily Movement · Profitable vs Non-Profitable Days</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Day-over-day change in stock-holdings value, rebuilt from transactions × daily closing prices (cash, PF and debt are not included; buys and sells are
        removed from the move). A day within ±{NEUTRAL_BAND_PCT}% counts as a minimal price movement. Hover a day for what moved; hover a month for its counts.
      </p>

      {loading || (refreshing && days.length === 0) ? (
        <GridSkeleton rows={4} cols={13} label={loading ? 'Loading daily prices…' : 'Fetching daily prices…'} />
      ) : days.length === 0 ? (
        <EmptyState compact text={refreshFailed ? 'Not enough daily price history, and the automatic price refresh failed. Try again later.' : 'Not enough daily price history.'} />
      ) : (
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {fys.map((fy) => (
                <button
                  key={fy}
                  type="button"
                  onClick={() => setSelectedFy(fy)}
                  aria-pressed={fy === activeFy}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    fy === activeFy ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {fyLabel(fy)}
                </button>
              ))}
              <span className={`ml-auto text-[10px] ${refreshFailed ? 'text-amber-600' : 'text-muted-foreground'}`} data-testid="price-freshness">
                {refreshing
                  ? 'Refreshing daily prices…'
                  : refreshFailed
                    ? `Couldn't refresh prices — showing stored data${latestBar ? ` through ${latestBar}` : ''}`
                    : latestBar ? `Daily prices through ${latestBar}` : ''}
              </span>
            </div>
            {fySummary && fySummary.active > 0 && <div className="mb-2"><FyStatement s={fySummary} hidden={hidden} /></div>}
            <div className="overflow-x-auto">
              <table className="text-[9px] font-mono border-separate border-spacing-0.5" aria-label={`Daily movement ${fyLabel(activeFy)}`}>
                <thead>
                  <tr>
                    <th className="p-1 text-muted-foreground font-medium">Month</th>
                    {DAYS_1_TO_31.map((n) => (
                      <th key={n} className="p-0.5 text-muted-foreground font-medium w-6">{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((mLabel, mi) => (
                    <tr key={mLabel}>
                      <td className="pr-2 text-muted-foreground font-medium whitespace-nowrap">{mLabel}</td>
                      {DAYS_1_TO_31.map((n) => {
                        const d = dayCells.get(`${mi}-${n}`);
                        return (
                          <td key={n} className="w-6 h-6 text-center border border-border/40 rounded-sm p-0" style={d ? { backgroundColor: dayColor(d) } : undefined}>
                            {d && (
                              <HoverPanel
                                title={`Daily movement · ${fmtDate(d.date)}`}
                                triggerLabel={`Daily movement for ${fmtDate(d.date)}`}
                                triggerClassName="w-full h-6 block"
                                trigger={<span className="sr-only">{fmtPct(d.pct)}</span>}
                              >
                                <DayDetail d={d} hidden={hidden} />
                              </HoverPanel>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowMonths((v) => !v)}
              aria-expanded={showMonths}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showMonths ? '' : '-rotate-90'}`} />
              Monthly summary
            </button>
            {showMonths && (
            <>
            <p className="text-[10px] text-muted-foreground mt-1 mb-1">
              <span className="text-gain">Profitable</span> · <span className="text-loss">Non Profitable</span> · Minimal Price movements
            </p>
            <div className="overflow-x-auto">
              <table className="text-[10px] font-mono border-separate border-spacing-1" aria-label="Monthly profitable day counts">
                <thead>
                  <tr>
                    <th className="p-1 text-muted-foreground font-medium">FY</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="p-1 text-muted-foreground font-medium w-16">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fys.map((fy) => (
                    <tr key={fy}>
                      <td className="pr-2 text-muted-foreground font-medium whitespace-nowrap">{fyLabel(fy)}</td>
                      {MONTHS.map((mLabel, mi) => {
                        const s = months.get(`${fy}-${mi}`);
                        return (
                          <td
                            key={mLabel}
                            className={`w-16 h-10 text-center border border-border/50 rounded-sm ${s && !s.final ? 'opacity-70 border-dashed' : ''}`}
                            style={{ backgroundColor: s ? monthColor(s) : 'hsl(var(--muted) / 0.3)' }}
                          >
                            {s ? (
                              <HoverPanel
                                title={`${mLabel} ${fyLabel(fy)} · day counts`}
                                triggerLabel={`Day counts for ${mLabel} ${fyLabel(fy)}`}
                                triggerClassName="w-full h-10 flex items-center justify-center gap-1"
                                trigger={
                                  <>
                                    <span className="font-semibold text-gain">{s.green}</span>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="font-semibold text-loss">{s.red}</span>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="text-muted-foreground">{s.grey}</span>
                                  </>
                                }
                              >
                                <MonthDetail s={s} hidden={hidden} />
                              </HoverPanel>
                            ) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
            )}
          </div>

          {symbolsWithoutPrices.length > 0 && (
            <p className="text-[10px] text-amber-600">
              {symbolsWithoutPrices.join(', ')} {symbolsWithoutPrices.length === 1 ? 'has' : 'have'} no stored daily price for part of the history; days
              where a held symbol was unpriced are left out rather than guessed.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
