import type { DerivedHolding } from '@/types/portfolio';

export interface Allocation {
  id: string;
  goal_id: string;
  source_type: 'symbol' | 'liquid_cash' | 'vault_cash';
  symbol: string | null;
  amount: number;      // rupees (used for cash sources)
  quantity: number | null; // units (used for symbol sources) — a snapshot; ignored when track_max is true
  track_max: boolean;  // symbol allocations only: always claim 100% of the current holding (minus other
                        // goals' fixed claims on the same symbol), so buying more units flows in automatically
}

// For a symbol allocation, resolve the *live* unit count it's actually claiming right now.
// - A fixed allocation (track_max = false) always claims exactly its stored `quantity` snapshot.
// - A track_max allocation claims "whatever's left" of the current holding after every fixed
//   allocation on the same symbol is subtracted — so a new BUY grows this automatically. If more
//   than one goal auto-tracks the same symbol (a conflict — they can't both own the remainder),
//   the remainder is split between them proportionally by their last stored quantity (equally if
//   none has one), rather than double-counting the same units into two goals.
export function resolveSymbolRequestQty(a: Allocation, holdings: DerivedHolding[], allAllocations: Allocation[]): number {
  if (a.source_type !== 'symbol' || !a.symbol) return 0;
  if (!a.track_max) return Number(a.quantity) || 0;
  const h = holdings.find((x) => x.symbol === a.symbol);
  const capacity = h ? h.totalQuantity : 0;
  const sameSymbol = allAllocations.filter((x) => x.source_type === 'symbol' && x.symbol === a.symbol);
  const fixedTotal = sameSymbol.filter((x) => !x.track_max).reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const remaining = Math.max(0, capacity - fixedTotal);
  const maxRows = sameSymbol.filter((x) => x.track_max);
  if (maxRows.length <= 1) return remaining;
  const weightSum = maxRows.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const myWeight = weightSum > 0 ? (Number(a.quantity) || 0) / weightSum : 1 / maxRows.length;
  return remaining * myWeight;
}

// Build a scale-map so per-source over-allocations shrink pro-rata to available.
export function buildScaleMap(
  allocations: Allocation[],
  holdings: DerivedHolding[],
  cash: { liquidCash: number; vaultCash: number },
): Record<string, number> {
  const totals: Record<string, number> = {};
  const capacity: Record<string, number> = {
    'cash:liquid': cash.liquidCash,
    'cash:vault': cash.vaultCash,
  };
  for (const a of allocations) {
    if (a.source_type === 'liquid_cash') totals['cash:liquid'] = (totals['cash:liquid'] || 0) + (Number(a.amount) || 0);
    else if (a.source_type === 'vault_cash') totals['cash:vault'] = (totals['cash:vault'] || 0) + (Number(a.amount) || 0);
    else if (a.symbol) {
      const key = `sym:${a.symbol}`;
      totals[key] = (totals[key] || 0) + resolveSymbolRequestQty(a, holdings, allocations);
      if (!(key in capacity)) {
        const h = holdings.find((x) => x.symbol === a.symbol);
        capacity[key] = h ? h.totalQuantity : 0;
      }
    }
  }
  const map: Record<string, number> = {};
  for (const key of Object.keys(totals)) {
    const t = totals[key];
    const c = capacity[key] ?? 0;
    map[key] = t > 0 && t > c ? Math.max(0, c / t) : 1;
  }
  return map;
}

/**
 * Market value (₹) currently allocated to each goal, resolved the way the Goal Tracker resolves it: a
 * `track_max` symbol row claims whatever is left of the LIVE holding (not its stored snapshot), and any
 * source claimed beyond what's actually held/available is scaled down pro-rata (`buildScaleMap`) rather than
 * counted twice. Equals the sum of `computeAllocTax(...).market` per goal on the Goal Tracker page.
 *
 * Every goal id in `goalIds` gets an entry (0 if it has no allocations).
 */
export function computeGoalMarketValues(
  goalIds: string[],
  allocations: Allocation[],
  holdings: DerivedHolding[],
  cash: { liquidCash: number; vaultCash: number },
): Record<string, number> {
  const scaleMap = buildScaleMap(allocations, holdings, cash);
  const values: Record<string, number> = {};
  for (const id of goalIds) values[id] = 0;

  for (const a of allocations) {
    if (!(a.goal_id in values)) continue;
    if (a.source_type === 'symbol') {
      if (!a.symbol) continue;
      const h = holdings.find((x) => x.symbol === a.symbol);
      if (!h || h.totalQuantity <= 0) continue;
      const qty = resolveSymbolRequestQty(a, holdings, allocations) * (scaleMap[`sym:${a.symbol}`] ?? 1);
      values[a.goal_id] += qty * h.currentPrice;
    } else {
      const key = a.source_type === 'liquid_cash' ? 'cash:liquid' : 'cash:vault';
      values[a.goal_id] += (Number(a.amount) || 0) * (scaleMap[key] ?? 1);
    }
  }
  return values;
}
