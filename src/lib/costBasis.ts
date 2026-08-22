import type { Transaction } from '@/types/portfolio';

export interface FifoLot {
  qty: number;
  price: number;
  date: string;
}

export interface FifoPosition {
  totalQuantity: number;
  totalInvested: number;
  avgPrice: number;
  /** Still-open lots after FIFO depletion, oldest first. */
  openLots: FifoLot[];
}

/**
 * FIFO cost basis for one symbol's transactions: each SELL consumes the
 * oldest still-open BUY lot(s) first. This matches the FIFO convention
 * already used by taxCalculator.ts and GoalTrack.tsx's getOpenLots (and
 * actual Indian capital-gains tax law) for the rest of the app.
 *
 * Previously, holdings math (usePortfolio.ts, periodReports.ts) instead
 * reduced "invested" by the SELL's proceeds (qty × sell price) rather
 * than by the cost basis of the shares actually sold. That let a
 * profitable partial sell understate the remaining position's cost
 * basis (inflating its apparent unrealized P&L%), and a loss-making
 * partial sell overstate it — see docs/reports-page-hardening notes.
 * Example: buy 10 @ ₹100, buy 10 @ ₹200, sell 10 → FIFO depletes the
 * ₹100 lot first, leaving 10 shares @ ₹200 (invested ₹2,000) — not the
 * old formula's invested = (10×100 + 10×200) − 10×sellPrice.
 *
 * `transactions` may be in any order; sorted internally by date. Assumes
 * the symbol is never oversold (more SELL qty than held) — an oversell
 * simply depletes all open lots to zero, same as GoalTrack.tsx.
 */
export function computeFifoPosition(transactions: Transaction[]): FifoPosition {
  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const lots: FifoLot[] = [];
  for (const t of sorted) {
    if (t.type === 'BUY') {
      lots.push({ qty: t.quantity, price: t.price, date: t.date });
    } else {
      let remaining = t.quantity;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const used = Math.min(lot.qty, remaining);
        lot.qty -= used;
        remaining -= used;
      }
    }
  }
  const openLots = lots.filter(l => l.qty > 1e-9);
  const totalQuantity = openLots.reduce((s, l) => s + l.qty, 0);
  const totalInvested = openLots.reduce((s, l) => s + l.qty * l.price, 0);
  const avgPrice = totalQuantity > 0 ? totalInvested / totalQuantity : 0;
  return { totalQuantity, totalInvested, avgPrice, openLots };
}
