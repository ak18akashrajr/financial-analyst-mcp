// Covers the "All Family" Goals feature: attributing a goal's symbol allocations to the family
// members who actually hold the underlying units, by market value. GoalTrack.tsx pools every
// member's transactions per symbol into one FIFO chain (see getOpenLots) — getMemberUnitShares
// re-runs that same FIFO chain but groups the surviving open lots by family_member_id instead of
// lot age, and computeGoalMemberContributions applies that ownership ratio to each symbol
// allocation's resolved market value. Cash allocations are deliberately excluded (see the doc
// comment on computeGoalMemberContributions in src/pages/GoalTrack.tsx).
import { describe, expect, it, vi } from 'vitest';
import {
  computeGoalMemberContributions,
  getMemberUnitShares,
  type Allocation,
} from '@/pages/GoalTrack';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

function txn(overrides: Partial<Transaction> & { type: 'BUY' | 'SELL'; quantity: number; date: string; familyMemberId: string }): Transaction {
  return { id: `t-${Math.random()}`, symbol: 'NIFTYBEES.NS', price: 100, ...overrides };
}

function holding(overrides: Partial<DerivedHolding> & { symbol: string; totalQuantity: number; transactions: Transaction[] }): DerivedHolding {
  return {
    avgPrice: 100,
    currentPrice: 100,
    totalInvested: 0,
    currentValue: 0,
    pnl: 0,
    pnlPercent: 0,
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

describe('getMemberUnitShares', () => {
  it('splits an untouched holding by each buyer\'s own units', () => {
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 300,
      transactions: [
        txn({ type: 'BUY', quantity: 200, date: '2025-01-01', familyMemberId: 'akash' }),
        txn({ type: 'BUY', quantity: 100, date: '2025-02-01', familyMemberId: 'priya' }),
      ],
    });
    expect(getMemberUnitShares(h)).toEqual({ akash: 200, priya: 100 });
  });

  it('consumes the oldest lot first on a SELL, regardless of which member sold', () => {
    // Akash's 200 (older) + Priya's 100 (newer) = 300. A SELL of 150 eats entirely into Akash's lot
    // under FIFO, leaving Akash with 50 and Priya untouched at 100 — same FIFO chain
    // getHoldingLotSplit already uses for the LT/ST tax split, just grouped by member instead of age.
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 150,
      transactions: [
        txn({ type: 'BUY', quantity: 200, date: '2025-01-01', familyMemberId: 'akash' }),
        txn({ type: 'BUY', quantity: 100, date: '2025-02-01', familyMemberId: 'priya' }),
        txn({ type: 'SELL', quantity: 150, date: '2025-03-01', familyMemberId: 'akash' }),
      ],
    });
    expect(getMemberUnitShares(h)).toEqual({ akash: 50, priya: 100 });
  });
});

describe('computeGoalMemberContributions', () => {
  it('splits a single symbol allocation\'s market value by each member\'s live unit share', () => {
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 300,
      currentPrice: 250,
      transactions: [
        txn({ type: 'BUY', quantity: 200, date: '2025-01-01', familyMemberId: 'akash' }),
        txn({ type: 'BUY', quantity: 100, date: '2025-02-01', familyMemberId: 'priya' }),
      ],
    });
    // track_max allocation claims the full 300-unit holding for this goal.
    const a = alloc({ id: 'a1', quantity: 300, track_max: true });
    const result = computeGoalMemberContributions([a], [h], [a], {});

    expect(result).toHaveLength(2);
    const akash = result.find((c) => c.familyMemberId === 'akash')!;
    const priya = result.find((c) => c.familyMemberId === 'priya')!;
    // 300 units * ₹250 = ₹75,000 total market value; 200/300 to Akash, 100/300 to Priya.
    expect(akash.marketValue).toBeCloseTo(50000);
    expect(priya.marketValue).toBeCloseTo(25000);
    expect(akash.pct).toBeCloseTo((2 / 3) * 100);
    expect(priya.pct).toBeCloseTo((1 / 3) * 100);
  });

  it('rolls up contributions across multiple symbol allocations in the same goal', () => {
    const h1 = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 100,
      currentPrice: 100,
      transactions: [txn({ type: 'BUY', quantity: 100, date: '2025-01-01', familyMemberId: 'akash', symbol: 'NIFTYBEES.NS' })],
    });
    const h2 = holding({
      symbol: 'GOLDBEES.NS',
      totalQuantity: 100,
      currentPrice: 100,
      transactions: [txn({ type: 'BUY', quantity: 100, date: '2025-01-01', familyMemberId: 'priya', symbol: 'GOLDBEES.NS' })],
    });
    const a1 = alloc({ id: 'a1', symbol: 'NIFTYBEES.NS', quantity: 100 });
    const a2 = alloc({ id: 'a2', symbol: 'GOLDBEES.NS', quantity: 100 });
    const result = computeGoalMemberContributions([a1, a2], [h1, h2], [a1, a2], {});

    const akash = result.find((c) => c.familyMemberId === 'akash')!;
    const priya = result.find((c) => c.familyMemberId === 'priya')!;
    expect(akash.marketValue).toBeCloseTo(10000);
    expect(priya.marketValue).toBeCloseTo(10000);
    expect(akash.pct).toBeCloseTo(50);
    expect(priya.pct).toBeCloseTo(50);
  });

  it('ignores cash allocations entirely', () => {
    const cashAlloc = alloc({ id: 'c1', source_type: 'liquid_cash', symbol: null, amount: 50000, quantity: null });
    const result = computeGoalMemberContributions([cashAlloc], [], [cashAlloc], {});
    expect(result).toEqual([]);
  });

  it('returns an empty list when the allocated symbol has no current holding', () => {
    const a = alloc({ id: 'a1', symbol: 'DELISTED.NS', quantity: 50 });
    const result = computeGoalMemberContributions([a], [], [a], {});
    expect(result).toEqual([]);
  });
});
