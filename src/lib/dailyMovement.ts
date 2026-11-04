/**
 * Day-by-day movement of the stock-holdings value, for the Charts "Daily Movement" heatmap and its
 * monthly green / red / grey summary.
 *
 * Nothing stores a daily series: `net_worth_history` is only written when a transaction or balance is
 * edited. So, like src/lib/portfolioSeries.ts, this rebuilds each day from `transactions` ×
 * `historical_prices` (1d bars). That means it covers STOCK HOLDINGS ONLY — cash, PF and card debt are
 * not part of a day's move.
 *
 * Rules, each deliberate:
 *  - Trading days are the weekday (Mon–Fri) dates that have a stored price for a held symbol. Weekend
 *    dates are dropped, which also keeps month-start-dated `interval: '1mo'` bars (written by the
 *    Rolling Returns page into the same table) from landing on a Saturday/Sunday as a fake day.
 *  - A day's P&L is `V_t − V_prev − netFlow_t`, so a BUY/SELL is never read as a gain or loss (same
 *    flow adjustment as `flowAdjustedReturns`). The P&L is split per symbol and the parts sum exactly.
 *  - A move is only computed between two consecutive trading days ≤ MAX_GAP_DAYS apart, with every held
 *    symbol priced at both ends. Anything else is left out rather than bridged.
 *  - Green / red / grey: |pct| ≤ NEUTRAL_BAND_PCT is grey.
 */
import { istDayOf } from './dateUtils';
import { daysBetween, type PricesBySymbol, type SeriesTransaction } from './portfolioSeries';

export const NEUTRAL_BAND_PCT = 0.05;
/** Longest calendar gap still treated as "the previous trading day" (a long weekend + a holiday). */
export const MAX_GAP_DAYS = 5;

const MIN_QTY = 1e-9;

export type DayClass = 'green' | 'red' | 'grey';

export interface SymbolMove {
  symbol: string;
  qtyPrev: number;
  qtyNow: number;
  /** Close on the previous trading day (null if the symbol was not yet held/priced then). */
  closePrev: number | null;
  /** Close on this day (null once the symbol is fully sold with no price on the day). */
  close: number | null;
  /** BUY value − SELL value dated since the previous trading day, in ₹. */
  netFlow: number;
  /** This symbol's share of the day's P&L, in ₹. */
  pnl: number;
}

export interface DayMovement {
  /** `YYYY-MM-DD`. */
  date: string;
  prevDate: string;
  prevValue: number;
  value: number;
  netFlow: number;
  pnl: number;
  pct: number;
  cls: DayClass;
  moves: SymbolMove[];
}

export interface DailyMovementResult {
  days: DayMovement[];
  /** Symbols held on some date with no price on or before it. */
  symbolsWithoutPrices: string[];
}

export function classifyDay(pct: number): DayClass {
  if (pct > NEUTRAL_BAND_PCT) return 'green';
  if (pct < -NEUTRAL_BAND_PCT) return 'red';
  return 'grey';
}

function isWeekday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
}

const day = (s: string): string => {
  const d = istDayOf(String(s ?? ''));
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
};

interface GridState {
  date: string;
  qty: Record<string, number>;
  close: Record<string, number | null>;
  value: number;
  complete: boolean;
}

export function buildDailyMovements(txns: SeriesTransaction[], pricesBySymbol: PricesBySymbol): DailyMovementResult {
  const normalized = txns
    .map((t) => ({
      symbol: t.symbol,
      type: t.type,
      quantity: Number(t.quantity),
      price: Number(t.price),
      date: day(t.date),
    }))
    .filter((t) => t.date !== '' && Number.isFinite(t.quantity) && Number.isFinite(t.price))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (normalized.length === 0) return { days: [], symbolsWithoutPrices: [] };

  const symbols = [...new Set(normalized.map((t) => t.symbol))];
  const bars: Record<string, { date: string; close: number }[]> = {};
  for (const s of symbols) {
    bars[s] = (pricesBySymbol[s] || [])
      .map((b) => ({ date: day(b.date), close: Number(b.close) }))
      .filter((b) => b.date !== '' && Number.isFinite(b.close) && b.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const firstTxn = normalized[0].date;
  const gridSet = new Set<string>();
  for (const s of symbols) for (const b of bars[s]) if (b.date >= firstTxn && isWeekday(b.date)) gridSet.add(b.date);
  const grid = [...gridSet].sort();

  const qty: Record<string, number> = {};
  const idx: Record<string, number> = {};
  for (const s of symbols) { qty[s] = 0; idx[s] = -1; }

  const missing = new Set<string>();
  const days: DayMovement[] = [];
  let prev: GridState | null = null;
  let ptr = 0;

  for (const date of grid) {
    const flow: Record<string, number> = {};
    while (ptr < normalized.length && normalized[ptr].date <= date) {
      const t = normalized[ptr++];
      const signed = t.type === 'BUY' ? t.quantity : -t.quantity;
      qty[t.symbol] += signed;
      flow[t.symbol] = (flow[t.symbol] ?? 0) + signed * t.price;
    }

    const close: Record<string, number | null> = {};
    let value = 0;
    let complete = true;
    for (const s of symbols) {
      const arr = bars[s];
      while (idx[s] + 1 < arr.length && arr[idx[s] + 1].date <= date) idx[s]++;
      close[s] = idx[s] >= 0 ? arr[idx[s]].close : null;
      if (qty[s] <= MIN_QTY) continue;
      if (close[s] == null) { complete = false; missing.add(s); continue; }
      value += qty[s] * (close[s] as number);
    }
    const cur: GridState = { date, qty: { ...qty }, close, value, complete };

    if (prev && prev.complete && complete && prev.value > 0 && daysBetween(prev.date, date) <= MAX_GAP_DAYS) {
      const moves: SymbolMove[] = [];
      let netFlow = 0;
      for (const s of symbols) {
        const qPrev = prev.qty[s] > MIN_QTY ? prev.qty[s] : 0;
        const qNow = cur.qty[s] > MIN_QTY ? cur.qty[s] : 0;
        const f = flow[s] ?? 0;
        if (qPrev === 0 && qNow === 0 && f === 0) continue;
        const vPrev = qPrev * (prev.close[s] ?? 0);
        const vNow = qNow * (cur.close[s] ?? 0);
        netFlow += f;
        moves.push({
          symbol: s,
          qtyPrev: qPrev,
          qtyNow: qNow,
          closePrev: prev.close[s],
          close: cur.close[s],
          netFlow: f,
          pnl: vNow - vPrev - f,
        });
      }
      const pnl = value - prev.value - netFlow;
      const pct = (pnl / prev.value) * 100;
      moves.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
      days.push({ date, prevDate: prev.date, prevValue: prev.value, value, netFlow, pnl, pct, cls: classifyDay(pct), moves });
    }
    prev = cur;
  }

  return { days, symbolsWithoutPrices: [...missing].sort() };
}

// ───────────────────────────── Monthly roll-up (Indian FY, Apr → Mar) ─────────────────────────────

/** FY start year of a `YYYY-MM-DD` date (Apr 2026 → 2026, Jan 2027 → 2026). */
export function fyOf(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** Column index in an Apr-first FY row: Apr = 0 … Mar = 11. */
export function fyMonthIdx(date: string): number {
  const m = Number(date.split('-')[1]);
  return (m - 4 + 12) % 12;
}

/** `YYYY-MM-DD` of the last Mon–Fri date of the calendar month (`month` is 1–12). */
export function lastWeekdayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this one
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface MonthSummary {
  fy: number;
  monthIdx: number;
  green: number;
  red: number;
  grey: number;
  /** Trading days that had a computable move: green + red + grey. */
  active: number;
  /** Sum of the days' P&L, ₹ (holdings only, flow-adjusted). */
  pnl: number;
  /** False while today (IST) is on or before the month's last weekday — the counts can still change. */
  final: boolean;
}

/**
 * Counts per FY-month. `todayIst` (`YYYY-MM-DD`) decides `final`: a month is final once today is
 * strictly after its last weekday, i.e. its last trading day has fully closed.
 */
export function summarizeMonths(days: DayMovement[], todayIst: string): Map<string, MonthSummary> {
  const out = new Map<string, MonthSummary>();
  for (const d of days) {
    const fy = fyOf(d.date);
    const monthIdx = fyMonthIdx(d.date);
    const key = `${fy}-${monthIdx}`;
    let s = out.get(key);
    if (!s) {
      const [y, m] = d.date.split('-').map(Number);
      s = { fy, monthIdx, green: 0, red: 0, grey: 0, active: 0, pnl: 0, final: todayIst > lastWeekdayOfMonth(y, m) };
      out.set(key, s);
    }
    s[d.cls]++;
    s.active++;
    s.pnl += d.pnl;
  }
  return out;
}

export interface FySummary {
  fy: number;
  green: number;
  red: number;
  grey: number;
  /** green + red + grey — every trading day with a computable move. */
  active: number;
  /** green ÷ active × 100 (grey days stay in the denominator); 0 when there are no active days. */
  profitRatePct: number;
  /** Sum of the FY's daily P&L, ₹ (holdings only, flow-adjusted). */
  pnl: number;
  /** False until today (IST) reaches the FY's last weekday in March (its last trading day). */
  final: boolean;
}

export function summarizeFy(days: DayMovement[], fy: number, todayIst: string): FySummary {
  const s: FySummary = { fy, green: 0, red: 0, grey: 0, active: 0, profitRatePct: 0, pnl: 0, final: todayIst >= lastWeekdayOfMonth(fy + 1, 3) };
  for (const d of days) {
    if (fyOf(d.date) !== fy) continue;
    s[d.cls]++;
    s.active++;
    s.pnl += d.pnl;
  }
  s.profitRatePct = s.active > 0 ? (s.green / s.active) * 100 : 0;
  return s;
}
