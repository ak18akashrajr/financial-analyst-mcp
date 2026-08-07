/**
 * Period Reports utilities — quarterly / half-yearly / yearly
 * FY in India runs April → March. FY2026-27 = Apr 1 2026 → Mar 31 2027.
 *
 * AUDIT RULES (strict — no fabricated MTM):
 *  - Completed periods: mark holdings using `historical_prices` close at-or-before
 *    the period end. If a symbol has no historical row, fall back to its
 *    avg cost basis (so unrealized P&L on that holding shows as 0 rather than
 *    being inflated by today's live price).
 *  - In-progress period: mark to LIVE price (industry standard MTD), with
 *    historical close → cost basis as deeper fallback.
 *  - Cash at past dates: use the latest `net_worth_history` snapshot
 *    AT-OR-BEFORE the asOf date. If none exists, cash values are 0
 *    (we never blend today's cash into a past period). The in-progress
 *    period may use live cash as fallback.
 */
import type { Transaction, DerivedHolding, CashSettings, CurrentPrices } from '@/types/portfolio';

export type PeriodType = 'quarter' | 'half' | 'year';

export interface PeriodDef {
  key: string;          // e.g. "FY2026-27-Q1"
  type: PeriodType;
  fy: string;           // "FY2026-27"
  label: string;        // "Q1 · Apr–Jun 2026"
  shortLabel: string;   // "Q1 FY27"
  start: Date;
  end: Date;            // exclusive (first day of next period)
}

export function getFYStart(fyStartYear: number): Date {
  return new Date(fyStartYear, 3, 1); // April 1
}

export function buildPeriods(fyStartYear: number, type: PeriodType): PeriodDef[] {
  const fy = `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  const apr = (y: number) => new Date(y, 3, 1);
  const jul = (y: number) => new Date(y, 6, 1);
  const oct = (y: number) => new Date(y, 9, 1);
  const jan = (y: number) => new Date(y, 0, 1);

  if (type === 'quarter') {
    return [
      { key: `${fy}-Q1`, type, fy, label: `Q1 · Apr–Jun ${fyStartYear}`,        shortLabel: `Q1 ${fy.slice(2)}`, start: apr(fyStartYear),     end: jul(fyStartYear) },
      { key: `${fy}-Q2`, type, fy, label: `Q2 · Jul–Sep ${fyStartYear}`,        shortLabel: `Q2 ${fy.slice(2)}`, start: jul(fyStartYear),     end: oct(fyStartYear) },
      { key: `${fy}-Q3`, type, fy, label: `Q3 · Oct–Dec ${fyStartYear}`,        shortLabel: `Q3 ${fy.slice(2)}`, start: oct(fyStartYear),     end: jan(fyStartYear + 1) },
      { key: `${fy}-Q4`, type, fy, label: `Q4 · Jan–Mar ${fyStartYear + 1}`,    shortLabel: `Q4 ${fy.slice(2)}`, start: jan(fyStartYear + 1), end: apr(fyStartYear + 1) },
    ];
  }
  if (type === 'half') {
    return [
      { key: `${fy}-H1`, type, fy, label: `H1 · Apr–Sep ${fyStartYear}`,        shortLabel: `H1 ${fy.slice(2)}`, start: apr(fyStartYear),     end: oct(fyStartYear) },
      { key: `${fy}-H2`, type, fy, label: `H2 · Oct ${fyStartYear} – Mar ${fyStartYear + 1}`, shortLabel: `H2 ${fy.slice(2)}`, start: oct(fyStartYear), end: apr(fyStartYear + 1) },
    ];
  }
  return [
    { key: `${fy}-FY`, type, fy, label: `Full Year · Apr ${fyStartYear} – Mar ${fyStartYear + 1}`, shortLabel: fy, start: apr(fyStartYear), end: apr(fyStartYear + 1) },
  ];
}

export function periodStatus(p: PeriodDef, now: Date = new Date()): 'completed' | 'in-progress' | 'upcoming' {
  if (now >= p.end) return 'completed';
  if (now >= p.start) return 'in-progress';
  return 'upcoming';
}

// ── Historical prices ──
// Each symbol's array MUST be sorted ascending by date (ISO string).
export type HistoricalPriceMap = Record<string, Array<{ date: string; close: number }>>;

/** Latest close at-or-before `asOf`. Returns null if none. */
function histCloseAtOrBefore(series: Array<{ date: string; close: number }> | undefined, asOf: Date): number | null {
  if (!series || series.length === 0) return null;
  const target = asOf.getTime();
  // Binary search (series ascending)
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = new Date(series[mid].date).getTime();
    if (t <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans === -1 ? null : Number(series[ans].close);
}

function histCloseAtOrBeforeWithDate(series: Array<{ date: string; close: number }> | undefined, asOf: Date): { date: string; close: number } | null {
  if (!series || series.length === 0) return null;
  const target = asOf.getTime();
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = new Date(series[mid].date).getTime();
    if (t <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans === -1 ? null : { date: series[ans].date, close: Number(series[ans].close) };
}

interface PriceResolveResult { price: number; source: 'live' | 'historical' | 'cost-fallback' | 'none'; }

function resolvePrice(
  symbol: string,
  asOf: Date,
  avgPrice: number,
  currentPrices: CurrentPrices,
  historical: HistoricalPriceMap,
  useLive: boolean,
): PriceResolveResult {
  if (useLive) {
    const live = currentPrices[symbol];
    if (typeof live === 'number' && live > 0) return { price: live, source: 'live' };
  }
  const hist = histCloseAtOrBefore(historical[symbol], asOf);
  if (hist != null && hist > 0) return { price: hist, source: 'historical' };
  if (avgPrice > 0) return { price: avgPrice, source: 'cost-fallback' };
  return { price: 0, source: 'none' };
}

// ── Snapshot at a point in time ──
export interface PeriodSnapshot {
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  netWorth: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
  holdings: DerivedHolding[];
  categoryExposure: { label: string; value: number; percent: number }[];
  geographyExposure: { label: string; value: number; percent: number }[];
  // Audit metadata
  priceSourceCounts: { live: number; historical: number; costFallback: number; none: number };
  /** Per-symbol price source used for this snapshot's mark. */
  priceSources: Record<string, 'live' | 'historical' | 'cost-fallback' | 'none'>;
  /** Per-symbol date of the historical close actually consumed (only when source='historical'). */
  priceDates: Record<string, string>;
  cashSource: 'live' | 'history' | 'none';
  asOf: Date;
}


function computeHoldingsAt(
  transactions: Transaction[],
  asOf: Date,
  currentPrices: CurrentPrices,
  symbolMeta: Record<string, { geography?: string; category?: string }>,
  historical: HistoricalPriceMap,
  useLive: boolean,
): {
  holdings: DerivedHolding[];
  counts: PeriodSnapshot['priceSourceCounts'];
  priceSources: PeriodSnapshot['priceSources'];
  priceDates: PeriodSnapshot['priceDates'];
} {
  const bySymbol: Record<string, Transaction[]> = {};
  for (const t of transactions) {
    if (new Date(t.date) <= asOf) {
      (bySymbol[t.symbol] ||= []).push(t);
    }
  }
  const counts = { live: 0, historical: 0, costFallback: 0, none: 0 };
  const priceSources: PeriodSnapshot['priceSources'] = {};
  const priceDates: PeriodSnapshot['priceDates'] = {};
  const holdings = Object.entries(bySymbol).map(([symbol, txns]) => {
    let qty = 0, invested = 0;
    for (const t of txns) {
      if (t.type === 'BUY') { qty += t.quantity; invested += t.quantity * t.price; }
      else                  { qty -= t.quantity; invested -= t.quantity * t.price; }
    }
    const avgPrice = qty > 0 ? invested / qty : 0;
    const resolved = resolvePrice(symbol, asOf, avgPrice, currentPrices, historical, useLive);
    if (qty > 0) {
      priceSources[symbol] = resolved.source;
      if (resolved.source === 'historical') {
        const hit = histCloseAtOrBeforeWithDate(historical[symbol], asOf);
        if (hit) priceDates[symbol] = hit.date;
      }
      if (resolved.source === 'live') counts.live++;
      else if (resolved.source === 'historical') counts.historical++;
      else if (resolved.source === 'cost-fallback') counts.costFallback++;
      else counts.none++;
    }
    const cp = resolved.price;
    const currentValue = cp * qty;
    const pnl = currentValue - invested;
    const meta = symbolMeta[symbol] || {};
    return {
      symbol, totalQuantity: qty, totalInvested: invested,
      avgPrice,
      currentPrice: cp, currentValue, pnl,
      pnlPercent: invested !== 0 ? (pnl / invested) * 100 : 0,
      transactions: txns,
      geography: meta.geography, category: meta.category,
    } as DerivedHolding;
  }).filter(h => h.totalQuantity > 0);
  return { holdings, counts, priceSources, priceDates };
}

function buildExposure(holdings: DerivedHolding[], cash: CashSettings, key: 'geography' | 'category') {
  const cashTotal = cash.liquidCash + cash.vaultCash;
  const pfTotal = cash.pfBalance;
  const groups: Record<string, number> = {};
  for (const h of holdings) {
    const label = (h as any)[key] || 'Untagged';
    groups[label] = (groups[label] || 0) + h.currentValue;
  }
  if (key === 'category') {
    if (cashTotal > 0) groups['Cash'] = (groups['Cash'] || 0) + cashTotal;
    if (pfTotal > 0) groups['PPF / EPF'] = (groups['PPF / EPF'] || 0) + pfTotal;
  } else {
    const indiaAdd = cashTotal + pfTotal;
    if (indiaAdd > 0) groups['India'] = (groups['India'] || 0) + indiaAdd;
  }
  const total = Object.values(groups).reduce((s, v) => s + v, 0);
  return Object.entries(groups)
    .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

export interface NetWorthHistoryRow {
  recorded_at: string;
  net_worth: number;
  portfolio_value: number;
  liquid_cash: number;
  vault_cash: number;
  pf_balance: number;
  credit_card_debt: number;
}

function nearestSnapshot(rows: NetWorthHistoryRow[], target: Date): NetWorthHistoryRow | null {
  const eligible = rows.filter(r => new Date(r.recorded_at) <= target);
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => new Date(a.recorded_at) > new Date(b.recorded_at) ? a : b);
}

export interface BuildSnapshotOptions {
  historicalPrices?: HistoricalPriceMap;
  /** true → mark holdings to live, fallback historical, fallback cost. Use for in-progress/current. */
  useLive?: boolean;
}

export function buildSnapshot(
  asOf: Date,
  transactions: Transaction[],
  currentPrices: CurrentPrices,
  symbolMeta: Record<string, { geography?: string; category?: string }>,
  netWorthHistory: NetWorthHistoryRow[],
  liveCash: CashSettings,
  options: BuildSnapshotOptions = {},
): PeriodSnapshot {
  const historical = options.historicalPrices ?? {};
  const useLive = options.useLive ?? false;

  const { holdings, counts, priceSources, priceDates } = computeHoldingsAt(transactions, asOf, currentPrices, symbolMeta, historical, useLive);
  const invested = holdings.reduce((s, h) => s + h.totalInvested, 0);
  const currentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const pnl = currentValue - invested;

  // Cash: strict — at-or-before snapshot, else zeros. Only useLive permits live fallback.
  const snap = nearestSnapshot(netWorthHistory, asOf);
  let cash: CashSettings;
  let cashSource: PeriodSnapshot['cashSource'];
  if (snap) {
    cash = {
      liquidCash: Number(snap.liquid_cash),
      vaultCash: Number(snap.vault_cash),
      pfBalance: Number(snap.pf_balance),
      creditCardDebt: Number(snap.credit_card_debt),
    };
    cashSource = 'history';
  } else if (useLive) {
    cash = liveCash;
    cashSource = 'live';
  } else {
    cash = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
    cashSource = 'none';
  }

  const netWorth = currentValue + cash.liquidCash + cash.vaultCash + cash.pfBalance - cash.creditCardDebt;

  return {
    invested, currentValue, pnl,
    pnlPercent: invested !== 0 ? (pnl / invested) * 100 : 0,
    netWorth,
    liquidCash: cash.liquidCash,
    vaultCash: cash.vaultCash,
    pfBalance: cash.pfBalance,
    creditCardDebt: cash.creditCardDebt,
    holdings,
    categoryExposure: buildExposure(holdings, cash, 'category'),
    geographyExposure: buildExposure(holdings, cash, 'geography'),
    priceSourceCounts: counts,
    priceSources,
    priceDates,
    cashSource,
    asOf,
  };
}

// ── Activity within a period ──
export interface PeriodActivity {
  buyCount: number;
  sellCount: number;
  buyValue: number;
  sellValue: number;
  netInvested: number;
  uniqueSymbols: number;
  gainers: DerivedHolding[];
  losers: DerivedHolding[];
  sipInvested: number; // sum of BUY value in period (proxy for SIP adherence)
}

export function buildActivity(
  p: PeriodDef,
  transactions: Transaction[],
  endSnapshot: PeriodSnapshot,
): PeriodActivity {
  const inPeriod = transactions.filter(t => {
    const d = new Date(t.date);
    return d >= p.start && d < p.end;
  });
  let buyCount = 0, sellCount = 0, buyValue = 0, sellValue = 0;
  const syms = new Set<string>();
  for (const t of inPeriod) {
    syms.add(t.symbol);
    if (t.type === 'BUY') { buyCount++; buyValue += t.quantity * t.price; }
    else                   { sellCount++; sellValue += t.quantity * t.price; }
  }
  // Only consider holdings with a real mark (not cost-fallback) for movers,
  // so we don't show fake 0% rows as "winners/losers".
  const valid = endSnapshot.holdings.filter(h => h.avgPrice > 0 && h.currentPrice > 0 && h.currentPrice !== h.avgPrice);
  const sortedDesc = [...valid].sort((a, b) => b.pnlPercent - a.pnlPercent);
  const gainers = sortedDesc.filter(h => h.pnlPercent > 0).slice(0, 3);
  const losers = [...valid].filter(h => h.pnlPercent < 0).sort((a, b) => a.pnlPercent - b.pnlPercent).slice(0, 3);
  return {
    buyCount, sellCount, buyValue, sellValue,
    netInvested: buyValue - sellValue,
    uniqueSymbols: syms.size,
    gainers,
    losers,
    sipInvested: buyValue,
  };
}

/** Calendar month diff between two dates (end exclusive). E.g. Apr 1 → Jul 1 = 3. */
export function calendarMonths(start: Date, end: Date): number {
  return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()));
}

// ── Projection for upcoming periods ──
export interface PeriodProjection {
  baseEndValue: number;       // optimistic (current XIRR)
  conservativeEndValue: number; // XIRR * 0.8
  baseRate: number;
  conservativeRate: number;
  monthsAhead: number;
}

export function projectPeriod(
  startValue: number,
  monthlySIP: number,
  periodStart: Date,
  periodEnd: Date,
  xirr: number | null,
  fallbackRatePct = 12,
): PeriodProjection {
  const annualRate = xirr ?? (fallbackRatePct / 100);
  const monthsAhead = calendarMonths(periodStart, periodEnd);

  const grow = (rate: number) => {
    const monthly = Math.pow(1 + rate, 1 / 12) - 1;
    let v = startValue;
    for (let m = 0; m < monthsAhead; m++) v = v * (1 + monthly) + monthlySIP;
    return v;
  };

  return {
    baseRate: annualRate,
    conservativeRate: annualRate * 0.8,
    baseEndValue: grow(annualRate),
    conservativeEndValue: grow(annualRate * 0.8),
    monthsAhead,
  };
}
