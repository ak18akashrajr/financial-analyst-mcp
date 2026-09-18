// Covers src/lib/familyPortfolioSplit.ts: splitting the combined "All Family" net worth back out
// by member. Holdings are attributed via the same FIFO lot-attribution the Goals per-member
// contribution feature uses (src/lib/lotAttribution.ts's getMemberUnitShares); cash is summed
// directly from each member's own cash_settings row since it has no lot history to attribute by.
import { describe, expect, it } from 'vitest';
import { computeFamilyNetWorthSplit, type MemberCashRow } from '@/lib/familyPortfolioSplit';
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

function cash(overrides: Partial<MemberCashRow> & { familyMemberId: string }): MemberCashRow {
  return { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0, ...overrides };
}

describe('computeFamilyNetWorthSplit', () => {
  it('splits a single holding\'s market value by each member\'s live unit share', () => {
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 300,
      currentPrice: 250,
      transactions: [
        txn({ type: 'BUY', quantity: 200, date: '2025-01-01', familyMemberId: 'akash' }),
        txn({ type: 'BUY', quantity: 100, date: '2025-02-01', familyMemberId: 'priya' }),
      ],
    });
    const result = computeFamilyNetWorthSplit([h], []);

    const akash = result.find((r) => r.familyMemberId === 'akash')!;
    const priya = result.find((r) => r.familyMemberId === 'priya')!;
    expect(akash.holdingsValue).toBeCloseTo(50000);
    expect(priya.holdingsValue).toBeCloseTo(25000);
    expect(akash.netWorth).toBeCloseTo(50000);
    expect(priya.netWorth).toBeCloseTo(25000);
  });

  it('adds each member\'s own cash_settings row on top of their holdings share', () => {
    const h = holding({
      symbol: 'NIFTYBEES.NS',
      totalQuantity: 100,
      currentPrice: 100,
      transactions: [txn({ type: 'BUY', quantity: 100, date: '2025-01-01', familyMemberId: 'akash' })],
    });
    const cashRows = [
      cash({ familyMemberId: 'akash', liquidCash: 20000, vaultCash: 30000 }),
      cash({ familyMemberId: 'priya', liquidCash: 15000 }),
    ];
    const result = computeFamilyNetWorthSplit([h], cashRows);

    const akash = result.find((r) => r.familyMemberId === 'akash')!;
    const priya = result.find((r) => r.familyMemberId === 'priya')!;
    // 100 units * ₹100 holdings + ₹20,000 + ₹30,000 cash.
    expect(akash.netWorth).toBeCloseTo(60000);
    // No holdings, just cash.
    expect(priya.holdingsValue).toBe(0);
    expect(priya.netWorth).toBeCloseTo(15000);
  });

  it('subtracts credit card debt from net worth', () => {
    const cashRows = [cash({ familyMemberId: 'akash', liquidCash: 50000, creditCardDebt: 20000 })];
    const result = computeFamilyNetWorthSplit([], cashRows);
    expect(result[0].netWorth).toBeCloseTo(30000);
  });

  it('sorts members by net worth, highest first', () => {
    const cashRows = [
      cash({ familyMemberId: 'priya', liquidCash: 10000 }),
      cash({ familyMemberId: 'akash', liquidCash: 90000 }),
    ];
    const result = computeFamilyNetWorthSplit([], cashRows);
    expect(result.map((r) => r.familyMemberId)).toEqual(['akash', 'priya']);
  });

  it('ignores a holding with no current price (never priced yet)', () => {
    const h = holding({
      symbol: 'UNPRICED.NS',
      totalQuantity: 100,
      currentPrice: 0,
      transactions: [txn({ type: 'BUY', quantity: 100, date: '2025-01-01', familyMemberId: 'akash' })],
    });
    const result = computeFamilyNetWorthSplit([h], []);
    expect(result).toEqual([]);
  });

  it('returns an empty list when there are no holdings or cash rows', () => {
    expect(computeFamilyNetWorthSplit([], [])).toEqual([]);
  });
});
