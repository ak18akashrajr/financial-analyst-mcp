// Covers src/lib/lotAttribution.ts: getOpenLots is the FIFO chain GoalTrack.tsx's LT/ST tax split
// already relies on; getMemberUnitShares re-runs that same chain but groups surviving open lots
// by family_member_id instead of lot age, so a symbol holding pooled across the "All Family" view
// can be attributed back to whichever member's units they actually are. Used by both the Goals
// per-member contribution feature (src/pages/GoalTrack.tsx) and the family net worth split card
// (src/lib/familyPortfolioSplit.ts).
import { describe, expect, it } from 'vitest';
import { getMemberUnitShares } from '@/lib/lotAttribution';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

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

  it('groups units with no family_member_id (e.g. legacy data) under "unknown"', () => {
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 100,
      transactions: [{ id: 't1', symbol: 'NIFTYBEES.NS', type: 'BUY', quantity: 100, price: 100, date: '2025-01-01' }],
    });
    expect(getMemberUnitShares(h)).toEqual({ unknown: 100 });
  });
});
