import type { Transaction } from '@/types/portfolio';

export interface TimelinePoint {
  /** `YYYY-MM-DD` key of the transaction day (or today, for the closing point). */
  date: string;
  /** Pre-formatted label for the chart axis. */
  dateLabel: string;
  /** Cost basis of the shares still held. */
  invested: number;
  currentValue: number;
  pnl: number;
}

interface Lot {
  qty: number;
  price: number;
}

interface SymbolState {
  lots: Lot[];
  lastPrice: number;
}

/**
 * Day-by-day "Principal Capital Allocated vs Current Value" series behind PortfolioCharts: after each
 * transaction day, the cost basis of what is held then, and that same quantity marked at the current price.
 *
 * Cost basis is FIFO — a SELL consumes the oldest still-open BUY lot(s) first — matching
 * src/lib/costBasis.ts, which is what the rest of the app (holdings table, summary, tax) uses. This chart
 * used to subtract the sale's PROCEEDS (qty x sell price) from "invested" instead, the exact formula
 * costBasis.ts documents as the bug it replaced: buy 10 @ 100 then sell 9 @ 500 gave invested −₹3,500
 * rather than ₹100, and a full exit erased the realised gain from the P&L line entirely.
 *
 * Still a hypothetical series, not a record: every past date is valued at TODAY's price (there is no
 * historical price per date here), and a symbol with no current price falls back to its last trade price.
 *
 * `formatDate` and `today` are injected so the function stays pure and unit-testable.
 */
export function buildPortfolioTimeline(
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  today: string,
  formatDate: (iso: string) => string,
): TimelinePoint[] {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const bySymbol: Record<string, SymbolState> = {};
  const byDate = new Map<string, Transaction[]>();
  for (const t of sorted) {
    const dateKey = t.date.split('T')[0];
    const day = byDate.get(dateKey);
    if (day) day.push(t);
    else byDate.set(dateKey, [t]);
  }

  const snapshot = (): { invested: number; currentValue: number } => {
    let invested = 0;
    let currentValue = 0;
    for (const [symbol, state] of Object.entries(bySymbol)) {
      const open = state.lots.filter((l) => l.qty > 1e-9);
      const quantity = open.reduce((s, l) => s + l.qty, 0);
      if (quantity > 0) {
        invested += open.reduce((s, l) => s + l.qty * l.price, 0);
        const price = currentPrices[symbol] || state.lastPrice;
        currentValue += price * quantity;
      }
    }
    return { invested, currentValue };
  };

  const points: TimelinePoint[] = [];
  for (const [dateKey, txns] of byDate) {
    for (const t of txns) {
      const state = (bySymbol[t.symbol] ||= { lots: [], lastPrice: t.price });
      if (t.type === 'BUY') {
        state.lots.push({ qty: t.quantity, price: t.price });
      } else {
        // FIFO: consume the oldest open lot(s); an oversell simply depletes everything, as in costBasis.ts.
        let remaining = t.quantity;
        for (const lot of state.lots) {
          if (remaining <= 0) break;
          const used = Math.min(lot.qty, remaining);
          lot.qty -= used;
          remaining -= used;
        }
      }
      state.lastPrice = t.price;
    }
    const { invested, currentValue } = snapshot();
    points.push({ date: dateKey, dateLabel: formatDate(dateKey), invested, currentValue, pnl: currentValue - invested });
  }

  // Close the series at today if the last transaction day isn't already today.
  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.date !== today) {
    const { invested, currentValue } = snapshot();
    points.push({ date: today, dateLabel: formatDate(today), invested, currentValue, pnl: currentValue - invested });
  }

  return points;
}
