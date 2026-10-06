// computeGoalMarketValues (src/lib/goalAllocations.ts): a goal's "currently allocated" value, resolved the
// way the Goal Tracker resolves it — live track_max quantities and pro-rata clamping of over-allocations
// (audit M10). Projections used to read the stored `quantity` snapshot and skip clamping instead.
import { describe, expect, it, vi } from 'vitest';
import { computeGoalMarketValues, type Allocation } from '@/lib/goalAllocations';
import { buildScaleMap, computeAllocTax } from '@/pages/GoalTrack';
import type { DerivedHolding } from '@/types/portfolio';

// GoalTrack.tsx imports the real supabase client at module scope (only for computeAllocTax's cross-check
// below), which throws without env vars — stub it, as the other GoalTrack helper tests do.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

function holding(symbol: string, totalQuantity: number, currentPrice: number): DerivedHolding {
  return {
    symbol,
    totalQuantity,
    currentPrice,
    avgPrice: currentPrice,
    totalInvested: totalQuantity * currentPrice,
    currentValue: totalQuantity * currentPrice,
    pnl: 0,
    pnlPercent: 0,
    transactions: [],
  } as unknown as DerivedHolding;
}

function alloc(overrides: Partial<Allocation> & { id: string }): Allocation {
  return {
    goal_id: 'g1',
    source_type: 'symbol',
    symbol: 'ACME',
    amount: 0,
    quantity: 0,
    track_max: false,
    ...overrides,
  };
}

const noCash = { liquidCash: 0, vaultCash: 0 };

describe('computeGoalMarketValues', () => {
  it('resolves a track_max row against the live holding, not its stored snapshot (the audit example)', () => {
    // Stored quantity 10 is stale; 20 units are held @ ₹1,500. Projections showed ₹15,000, Goal Tracker ₹30,000.
    const holdings = [holding('ACME', 20, 1500)];
    const a = alloc({ id: 'a1', quantity: 10, track_max: true });

    expect(computeGoalMarketValues(['g1'], [a], holdings, noCash)).toEqual({ g1: 30_000 });
  });

  it('uses the stored quantity for a fixed (non track_max) row', () => {
    const holdings = [holding('ACME', 20, 1500)];
    const a = alloc({ id: 'a1', quantity: 10, track_max: false });

    expect(computeGoalMarketValues(['g1'], [a], holdings, noCash).g1).toBe(15_000);
  });

  it('clamps an over-allocation to what is actually held instead of counting units that do not exist', () => {
    // Two goals each claim 15 fixed units of a 20-unit holding: total 30 > 20, so each shrinks by 20/30.
    const holdings = [holding('ACME', 20, 100)];
    const allocs = [
      alloc({ id: 'a1', goal_id: 'g1', quantity: 15 }),
      alloc({ id: 'a2', goal_id: 'g2', quantity: 15 }),
    ];
    const values = computeGoalMarketValues(['g1', 'g2'], allocs, holdings, noCash);

    expect(values.g1).toBeCloseTo(1000, 6); // 15 x 20/30 x ₹100
    expect(values.g2).toBeCloseTo(1000, 6);
    expect(values.g1 + values.g2).toBeCloseTo(20 * 100, 6); // never more than the holding is worth
  });

  it('gives a track_max row whatever is left after other goals\' fixed claims', () => {
    const holdings = [holding('ACME', 100, 10)];
    const allocs = [
      alloc({ id: 'fixed', goal_id: 'g1', quantity: 30 }),
      alloc({ id: 'max', goal_id: 'g2', quantity: 5, track_max: true }),
    ];
    const values = computeGoalMarketValues(['g1', 'g2'], allocs, holdings, noCash);

    expect(values.g1).toBe(300);
    expect(values.g2).toBe(700); // the remaining 70 units
  });

  it('does not double-count units when two goals both auto-track the same symbol', () => {
    const holdings = [holding('ACME', 100, 10)];
    const allocs = [
      alloc({ id: 'm1', goal_id: 'g1', quantity: 0, track_max: true }),
      alloc({ id: 'm2', goal_id: 'g2', quantity: 0, track_max: true }),
    ];
    const values = computeGoalMarketValues(['g1', 'g2'], allocs, holdings, noCash);

    expect(values.g1 + values.g2).toBeCloseTo(1000, 6); // the one holding, split — not 2000
  });

  it('counts cash allocations at face value and scales them down when they exceed the balance', () => {
    const allocs = [
      alloc({ id: 'c1', goal_id: 'g1', source_type: 'liquid_cash', symbol: null, amount: 40_000 }),
      alloc({ id: 'c2', goal_id: 'g2', source_type: 'liquid_cash', symbol: null, amount: 60_000 }),
      alloc({ id: 'v1', goal_id: 'g1', source_type: 'vault_cash', symbol: null, amount: 10_000 }),
    ];
    // Operating cash is only ₹50k against ₹1L claimed -> factor 0.5; the vault claim fits.
    const values = computeGoalMarketValues(['g1', 'g2'], allocs, [], { liquidCash: 50_000, vaultCash: 20_000 });

    expect(values.g1).toBe(40_000 * 0.5 + 10_000);
    expect(values.g2).toBe(60_000 * 0.5);
  });

  it('values a symbol that is no longer held at zero', () => {
    const a = alloc({ id: 'a1', quantity: 10 });
    expect(computeGoalMarketValues(['g1'], [a], [], noCash).g1).toBe(0);
    expect(computeGoalMarketValues(['g1'], [a], [holding('ACME', 0, 100)], noCash).g1).toBe(0);
  });

  it('returns an entry for every goal, zero when it has no allocations, and ignores allocations for unknown goals', () => {
    const holdings = [holding('ACME', 10, 100)];
    const allocs = [alloc({ id: 'a1', goal_id: 'ghost', quantity: 10 })];
    expect(computeGoalMarketValues(['g1', 'g2'], allocs, holdings, noCash)).toEqual({ g1: 0, g2: 0 });
  });

  it("matches the Goal Tracker's own per-goal market totals (computeAllocTax) for a mixed set", () => {
    // The point of sharing the resolver: both pages must agree, whatever the mix.
    const holdings = [holding('ACME', 20, 1500), holding('BETA', 50, 80)];
    const allocs = [
      alloc({ id: 'a1', goal_id: 'g1', symbol: 'ACME', quantity: 10, track_max: true }),
      alloc({ id: 'a2', goal_id: 'g2', symbol: 'ACME', quantity: 8 }),
      alloc({ id: 'a3', goal_id: 'g1', symbol: 'BETA', quantity: 80 }), // over-allocated -> clamped
      alloc({ id: 'a4', goal_id: 'g2', source_type: 'liquid_cash', symbol: null, amount: 90_000 }),
    ];
    const cash = { liquidCash: 60_000, vaultCash: 0 };

    const shared = computeGoalMarketValues(['g1', 'g2'], allocs, holdings, cash);

    // GoalTrack.tsx's goalProgress loop, reproduced.
    const scaleMap = buildScaleMap(allocs, holdings, cash);
    const fromTracker: Record<string, number> = { g1: 0, g2: 0 };
    for (const a of allocs) fromTracker[a.goal_id] += computeAllocTax(a, holdings, scaleMap, allocs).market;

    expect(shared.g1).toBeCloseTo(fromTracker.g1, 6);
    expect(shared.g2).toBeCloseTo(fromTracker.g2, 6);
  });
});
