// Covers the fix to src/pages/GoalTrack.tsx where a symbol allocation created via "Use max" used
// to freeze at whatever unit count was available at add-time: buying more units of a holding
// already earmarked to a goal never grew that goal's progress until the allocation was deleted
// and re-added. `track_max` allocations now resolve their live claim off the current holding
// instead of a stored snapshot — this tests that resolution directly (see
// src/test/goal-track-timeline.test.tsx for the page-level "wiring" test of the same page).
import { describe, expect, it, vi } from 'vitest';
import { resolveSymbolRequestQty, computeAllocTax, buildScaleMap, type Allocation } from '@/pages/GoalTrack';
import type { DerivedHolding } from '@/types/portfolio';

// GoalTrack.tsx imports the real supabase client at module scope, which throws without env vars —
// stub it out (vi.mock calls are hoisted above imports by vitest) since this file only exercises
// the page's pure allocation-math exports.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

function holding(overrides: Partial<DerivedHolding> & { symbol: string; totalQuantity: number }): DerivedHolding {
  return {
    avgPrice: 100,
    currentPrice: 100,
    totalInvested: 0,
    currentValue: 0,
    pnl: 0,
    pnlPercent: 0,
    transactions: [],
    ...overrides,
  };
}

function alloc(overrides: Partial<Allocation> & { id: string }): Allocation {
  return {
    goal_id: 'g1',
    source_type: 'symbol',
    symbol: 'NIFTYBEES.NS',
    amount: 0,
    quantity: 0,
    track_max: false,
    ...overrides,
  };
}

describe('resolveSymbolRequestQty', () => {
  it('returns the stored quantity unchanged for a fixed (non track_max) allocation', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 500 })];
    const a = alloc({ id: 'a1', quantity: 100, track_max: false });
    expect(resolveSymbolRequestQty(a, holdings, [a])).toBe(100);
  });

  it('claims the full holding when it is the only allocation on that symbol', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 300 })];
    const a = alloc({ id: 'a1', quantity: 300, track_max: true });
    expect(resolveSymbolRequestQty(a, holdings, [a])).toBe(300);
  });

  it('grows automatically when the holding grows — the actual bug reported', () => {
    const a = alloc({ id: 'a1', quantity: 300, track_max: true });
    // Snapshot at "Use max" time: 300 units.
    expect(resolveSymbolRequestQty(a, [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 300 })], [a])).toBe(300);
    // A later BUY brings the holding to 450 units — track_max should follow without touching `a`.
    expect(resolveSymbolRequestQty(a, [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 450 })], [a])).toBe(450);
  });

  it('claims only the remainder left over after other goals\' fixed allocations on the same symbol', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 300 })];
    const fixed = alloc({ id: 'fixed', goal_id: 'gFixed', quantity: 80, track_max: false });
    const auto = alloc({ id: 'auto', goal_id: 'gAuto', quantity: 220, track_max: true });
    const all = [fixed, auto];
    expect(resolveSymbolRequestQty(fixed, holdings, all)).toBe(80);
    expect(resolveSymbolRequestQty(auto, holdings, all)).toBe(220); // 300 - 80
  });

  it('splits the remainder proportionally when two goals both track_max the same symbol', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 300 })];
    // Last known snapshots were 200 and 100 — a 2:1 split of whatever remains (300 here, no fixed claims).
    const autoA = alloc({ id: 'autoA', goal_id: 'gA', quantity: 200, track_max: true });
    const autoB = alloc({ id: 'autoB', goal_id: 'gB', quantity: 100, track_max: true });
    const all = [autoA, autoB];
    expect(resolveSymbolRequestQty(autoA, holdings, all)).toBeCloseTo(200);
    expect(resolveSymbolRequestQty(autoB, holdings, all)).toBeCloseTo(100);
  });

  it('splits evenly when multiple track_max rows have no stored quantity to weight by', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 300 })];
    const autoA = alloc({ id: 'autoA', goal_id: 'gA', quantity: 0, track_max: true });
    const autoB = alloc({ id: 'autoB', goal_id: 'gB', quantity: 0, track_max: true });
    const all = [autoA, autoB];
    expect(resolveSymbolRequestQty(autoA, holdings, all)).toBe(150);
    expect(resolveSymbolRequestQty(autoB, holdings, all)).toBe(150);
  });

  it('never goes negative when fixed claims already exceed the holding', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 50 })];
    const fixed = alloc({ id: 'fixed', quantity: 80, track_max: false });
    const auto = alloc({ id: 'auto', quantity: 20, track_max: true });
    const all = [fixed, auto];
    expect(resolveSymbolRequestQty(auto, holdings, all)).toBe(0);
  });
});

describe('computeAllocTax — track_max rows', () => {
  it('reports the live resolved quantity as storedQty and keeps effectiveQty in sync with a live buy', () => {
    const a = alloc({ id: 'a1', quantity: 100, track_max: true });
    const before = computeAllocTax(a, [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 100, currentPrice: 120 })], {}, [a]);
    expect(before.storedQty).toBe(100);
    expect(before.effectiveQty).toBe(100);
    expect(before.market).toBe(100 * 120);
    expect(before.trackMax).toBe(true);

    const after = computeAllocTax(a, [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 160, currentPrice: 120 })], {}, [a]);
    expect(after.storedQty).toBe(160);
    expect(after.effectiveQty).toBe(160);
    expect(after.market).toBe(160 * 120);
  });
});

describe('buildScaleMap — track_max rows', () => {
  it('never clamps a solitary track_max allocation, since it always claims exactly the live capacity', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 250 })];
    const a = alloc({ id: 'a1', quantity: 100, track_max: true }); // stale stored snapshot
    const map = buildScaleMap([a], holdings, { liquidCash: 0, vaultCash: 0 });
    expect(map['sym:NIFTYBEES.NS']).toBe(1);
  });

  it('still clamps pro-rata when a manual (non track_max) over-allocation exceeds the holding', () => {
    const holdings = [holding({ symbol: 'NIFTYBEES.NS', totalQuantity: 100 })];
    const a = alloc({ id: 'a1', quantity: 150, track_max: false });
    const map = buildScaleMap([a], holdings, { liquidCash: 0, vaultCash: 0 });
    expect(map['sym:NIFTYBEES.NS']).toBeCloseTo(100 / 150);
  });
});
