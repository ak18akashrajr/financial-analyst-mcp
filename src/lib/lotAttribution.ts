import { parseLocalDate } from '@/lib/dateUtils';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

export interface OpenLot {
  qty: number;
  price: number;
  date: Date;
  familyMemberId: string | null;
}

// FIFO match SELL against BUY lots; return remaining open BUY lots {qty, price, date, familyMemberId}.
// Shared by GoalTrack.tsx (LT/ST tax split via getHoldingLotSplit) and any other feature that needs
// to know whose units a holding's currently-open lots trace back to.
export function getOpenLots(transactions: Transaction[]): OpenLot[] {
  const buys = transactions
    .filter((t) => t.type === 'BUY')
    // t.date is a bare Postgres DATE string ('YYYY-MM-DD', no time/offset) — parse it as LOCAL
    // midnight via parseLocalDate, not the bare UTC-midnight `new Date(...)` parse, so it lines up
    // with `now = Date.now()` in age-based calculations downstream. See TODO.md's High Priority
    // Action Items and dateUtils.ts's parseLocalDate doc comment for the LT/ST-threshold
    // misclassification bug this avoids.
    .map((t) => ({ qty: t.quantity, price: t.price, date: parseLocalDate(t.date), familyMemberId: t.familyMemberId ?? null }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let sellQty = transactions
    .filter((t) => t.type === 'SELL')
    .reduce((s, t) => s + t.quantity, 0);
  for (const lot of buys) {
    if (sellQty <= 0) break;
    const used = Math.min(lot.qty, sellQty);
    lot.qty -= used;
    sellQty -= used;
  }
  return buys.filter((l) => l.qty > 0);
}

// Each currently-held unit of a symbol "belongs" to whichever member's BUY lot it FIFO-traces
// back to (same FIFO chain GoalTrack.tsx's getHoldingLotSplit uses for the LT/ST tax split, just
// grouped by family_member_id instead of lot age). Only meaningful in the combined "All Family"
// view, where a symbol's holding pools every member's transactions — for a single member's own
// view every open lot already belongs to them.
export function getMemberUnitShares(h: DerivedHolding): Record<string, number> {
  const lots = getOpenLots(h.transactions);
  const shares: Record<string, number> = {};
  for (const lot of lots) {
    const key = lot.familyMemberId ?? 'unknown';
    shares[key] = (shares[key] || 0) + lot.qty;
  }
  return shares;
}
