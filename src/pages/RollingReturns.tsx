import { useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/AppNav';
import { SiteFooter } from '@/components/SiteFooter';
import { PrivacyProvider } from '@/contexts/PrivacyContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { supabase } from '@/integrations/supabase/client';
import { calculateXIRR } from '@/lib/xirr';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2, RefreshCw, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { Transaction } from '@/types/portfolio';
import { parseLocalDate } from '@/lib/dateUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';

interface PricePoint { date: string; close: number; }

// Compute window XIRR for a single symbol given transactions and price history within [start,end]
export function computeWindowXIRR(
  symbol: string,
  txns: Transaction[],
  prices: PricePoint[],
  windowEnd: Date,
  yearsBack: number,
): number | null {
  const start = new Date(windowEnd);
  start.setFullYear(start.getFullYear() - yearsBack);

  // Determine quantity held at window start (sum of all txns before start)
  let qtyAtStart = 0;
  let costAtStart = 0;
  for (const t of txns) {
    const d = parseLocalDate(t.date);
    if (d > start) continue;
    if (t.type === 'BUY') { qtyAtStart += t.quantity; costAtStart += t.quantity * t.price; }
    else { qtyAtStart -= t.quantity; costAtStart -= t.quantity * t.price; }
  }

  // Price at start (closest <= start)
  const sortedPrices = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const startPrice = sortedPrices.filter(p => parseLocalDate(p.date) <= start).slice(-1)[0]?.close;
  const endPrice = sortedPrices.filter(p => parseLocalDate(p.date) <= windowEnd).slice(-1)[0]?.close;
  if (!endPrice) return null;

  const cashFlows: { amount: number; date: Date }[] = [];

  // Open position synthetic outflow at start
  if (qtyAtStart > 0 && startPrice) {
    cashFlows.push({ amount: -qtyAtStart * startPrice, date: start });
  }

  // Transactions inside window
  let qty = qtyAtStart;
  for (const t of txns) {
    const d = parseLocalDate(t.date);
    if (d <= start || d > windowEnd) continue;
    if (t.type === 'BUY') { cashFlows.push({ amount: -t.quantity * t.price, date: d }); qty += t.quantity; }
    else { cashFlows.push({ amount: t.quantity * t.price, date: d }); qty -= t.quantity; }
  }

  // Terminal value at windowEnd
  if (qty > 0) cashFlows.push({ amount: qty * endPrice, date: windowEnd });

  if (cashFlows.length < 2) return null;
  return calculateXIRR(cashFlows);
}

// Portfolio-wide rolling XIRR: combine all txns across symbols, aggregate market value at each
// window endpoint using each symbol's own price history.
export function computePortfolioWindowXIRR(
  transactions: Transaction[],
  pricesBySymbol: Record<string, PricePoint[]>,
  windowEnd: Date,
  yearsBack: number,
): number | null {
  const start = new Date(windowEnd);
  start.setFullYear(start.getFullYear() - yearsBack);

  // Quantity per symbol at start
  const qtyAtStart: Record<string, number> = {};
  for (const t of transactions) {
    const d = parseLocalDate(t.date);
    if (d > start) continue;
    qtyAtStart[t.symbol] = (qtyAtStart[t.symbol] || 0) + (t.type === 'BUY' ? t.quantity : -t.quantity);
  }

  const priceAt = (sym: string, dt: Date): number | null => {
    const arr = pricesBySymbol[sym];
    if (!arr) return null;
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const p = sorted.filter(x => parseLocalDate(x.date) <= dt).slice(-1)[0];
    return p?.close ?? null;
  };

  const cashFlows: { amount: number; date: Date }[] = [];

  let startValue = 0;
  let allHavePrice = true;
  for (const [sym, q] of Object.entries(qtyAtStart)) {
    if (q <= 0) continue;
    const p = priceAt(sym, start);
    if (p == null) { allHavePrice = false; break; }
    startValue += q * p;
  }
  if (!allHavePrice) return null;
  if (startValue > 0) cashFlows.push({ amount: -startValue, date: start });

  // Txns inside window
  const qtyNow = { ...qtyAtStart };
  for (const t of transactions) {
    const d = parseLocalDate(t.date);
    if (d <= start || d > windowEnd) continue;
    const amt = t.quantity * t.price;
    cashFlows.push({ amount: t.type === 'BUY' ? -amt : amt, date: d });
    qtyNow[t.symbol] = (qtyNow[t.symbol] || 0) + (t.type === 'BUY' ? t.quantity : -t.quantity);
  }

  let endValue = 0;
  for (const [sym, q] of Object.entries(qtyNow)) {
    if (q <= 0) continue;
    const p = priceAt(sym, windowEnd);
    if (p == null) return null;
    endValue += q * p;
  }
  if (endValue > 0) cashFlows.push({ amount: endValue, date: windowEnd });

  if (cashFlows.length < 2) return null;
  return calculateXIRR(cashFlows);
}

const WINDOW_OPTIONS = [
  { id: '1y', label: '1Y', years: 1 },
  { id: '3y', label: '3Y', years: 3 },
  { id: '5y', label: '5Y', years: 5 },
];

const RollingContent = () => {
  const { holdings, transactions, loading } = usePortfolio();
  const [pricesBySymbol, setPricesBySymbol] = useState<Record<string, PricePoint[]>>({});
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<string>('PORTFOLIO');
  const [windowYears, setWindowYears] = useState<number>(1);

  const symbols = useMemo(() => holdings.map(h => h.symbol), [holdings]);

  const loadCachedPrices = async () => {
    if (symbols.length === 0) return;
    const { data } = await supabase
      .from('historical_prices')
      .select('symbol,date,close')
      .in('symbol', symbols);
    if (data) {
      const map: Record<string, PricePoint[]> = {};
      for (const r of data) {
        if (!map[r.symbol]) map[r.symbol] = [];
        map[r.symbol].push({ date: r.date as string, close: Number(r.close) });
      }
      setPricesBySymbol(map);
    }
  };

  useEffect(() => { loadCachedPrices(); }, [symbols.join(',')]);

  const fetchAll = async () => {
    if (symbols.length === 0) return;
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-historical-prices', {
        body: { symbols, range: '10y', interval: '1mo' },
      });
      if (error) throw error;
      const prices = (data?.prices ?? {}) as Record<string, PricePoint[]>;
      setPricesBySymbol(prev => ({ ...prev, ...prices }));
      toast.success(`Fetched history for ${Object.keys(prices).length} symbol(s)`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch historical prices');
    } finally {
      setFetching(false);
    }
  };

  const txnsBySymbol = useMemo(() => {
    const map: Record<string, Transaction[]> = {};
    for (const t of transactions) {
      if (!map[t.symbol]) map[t.symbol] = [];
      map[t.symbol].push(t);
    }
    return map;
  }, [transactions]);

  // Build month-end dates from earliest txn to today
  const monthEnds = useMemo(() => {
    if (transactions.length === 0) return [];
    const earliest = transactions.reduce((m, t) => {
      const d = parseLocalDate(t.date); return d < m ? d : m;
    }, new Date());
    const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    const today = new Date();
    const dates: Date[] = [];
    const cur = new Date(start);
    while (cur <= today) {
      const me = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      dates.push(me);
      cur.setMonth(cur.getMonth() + 1);
    }
    return dates;
  }, [transactions]);

  // Per-holding current XIRR for table
  const holdingRows = useMemo(() => {
    const today = new Date();
    return holdings.map(h => {
      const txns = txnsBySymbol[h.symbol] || [];
      const prices = pricesBySymbol[h.symbol] || [];
      const r1 = computeWindowXIRR(h.symbol, txns, prices, today, 1);
      const r3 = computeWindowXIRR(h.symbol, txns, prices, today, 3);
      const r5 = computeWindowXIRR(h.symbol, txns, prices, today, 5);
      return { symbol: h.symbol, r1, r3, r5 };
    });
  }, [holdings, txnsBySymbol, pricesBySymbol]);

  const portfolioWindowXIRR = (windowEnd: Date, yearsBack: number): number | null =>
    computePortfolioWindowXIRR(transactions, pricesBySymbol, windowEnd, yearsBack);

  // Rolling chart data for selected
  const chartData = useMemo(() => {
    const out: { date: string; xirr: number | null }[] = [];
    for (const me of monthEnds) {
      let r: number | null = null;
      if (selected === 'PORTFOLIO') r = portfolioWindowXIRR(me, windowYears);
      else {
        const txns = txnsBySymbol[selected] || [];
        const prices = pricesBySymbol[selected] || [];
        r = computeWindowXIRR(selected, txns, prices, me, windowYears);
      }
      out.push({ date: me.toISOString().slice(0, 7), xirr: r != null ? +(r * 100).toFixed(2) : null });
    }
    return out;
  }, [monthEnds, selected, windowYears, pricesBySymbol, txnsBySymbol, transactions]);

  const { selection: rangeSelection, handlers: rangeHandlers, clear: clearRange } = useChartRangeSelection();
  const rangeResult =
    rangeSelection.startIndex !== null && rangeSelection.endIndex !== null
      ? computeRangeReturn(chartData, rangeSelection.startIndex, rangeSelection.endIndex, 'xirr', 'date')
      : null;

  const fmtPct = (r: number | null) => r == null ? '—' : `${(r * 100).toFixed(2)}%`;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <AppNav />

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Rolling Returns</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Time-weighted XIRR over rolling 1Y / 3Y / 5Y windows. Best for SIP portfolios — accounts for cash-flow timing.
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={fetching || symbols.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
          >
            {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {fetching ? 'Fetching…' : 'Fetch History'}
          </button>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* Summary table */}
            <div className="rounded-lg border border-border bg-card overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b border-border">
                  <tr className="text-left">
                    <th className="font-medium px-4 py-2">Symbol</th>
                    <th className="font-medium px-4 py-2">1Y XIRR</th>
                    <th className="font-medium px-4 py-2">3Y XIRR</th>
                    <th className="font-medium px-4 py-2">5Y XIRR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border bg-accent/30">
                    <td className="px-4 py-2 font-semibold text-foreground">Overall Portfolio</td>
                    <td className="px-4 py-2 font-mono">{fmtPct(portfolioWindowXIRR(new Date(), 1))}</td>
                    <td className="px-4 py-2 font-mono">{fmtPct(portfolioWindowXIRR(new Date(), 3))}</td>
                    <td className="px-4 py-2 font-mono">{fmtPct(portfolioWindowXIRR(new Date(), 5))}</td>
                  </tr>
                  {holdingRows.map(r => (
                    <tr key={r.symbol} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">{r.symbol}</td>
                      <td className="px-4 py-2 font-mono">{fmtPct(r.r1)}</td>
                      <td className="px-4 py-2 font-mono">{fmtPct(r.r3)}</td>
                      <td className="px-4 py-2 font-mono">{fmtPct(r.r5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Chart controls */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PORTFOLIO">Overall Portfolio</SelectItem>
                  {holdings.map(h => <SelectItem key={h.symbol} value={h.symbol}>{h.symbol}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
                {WINDOW_OPTIONS.map(w => (
                  <button
                    key={w.id}
                    onClick={() => setWindowYears(w.years)}
                    className={`px-2.5 py-1 text-xs font-medium rounded ${
                      windowYears === w.years ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Info className="w-3.5 h-3.5" />
                Rolling {windowYears}Y XIRR — each point is the XIRR computed over the prior {windowYears} year(s) ending that month.
              </div>
              <div className="relative">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} {...rangeHandlers}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => v == null ? '—' : `${v}%`}
                    />
                    <Legend />
                    <ChartRangeReferenceArea selection={rangeSelection} data={chartData} labelKey="date" />
                    <Line type="monotone" dataKey="xirr" name={`${windowYears}Y XIRR`} stroke="hsl(var(--primary))" dot={false} strokeWidth={2} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
                <ChartRangeBadge selection={rangeSelection} result={rangeResult} onClear={clearRange} unit="rate" valueLabel={`${windowYears}Y XIRR`} />
              </div>
            </div>

            {symbols.length > 0 && Object.keys(pricesBySymbol).length === 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                No cached history yet. Click "Fetch History" to pull monthly closes from Yahoo Finance.
              </p>
            )}
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
};

const RollingReturns = () => (
  <PrivacyProvider>
    <RollingContent />
  </PrivacyProvider>
);

export default RollingReturns;
