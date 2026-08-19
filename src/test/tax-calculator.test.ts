// Unit tests for generateTaxReport (FIFO tax-lot computation + LTCG exemption). See
// src/lib/taxCalculator.ts. Dates are expressed relative to `Date.now()` rather than fixed
// calendar dates, since the module reads `new Date()` internally for "today" — a fixed date
// would eventually drift into the wrong long-term/short-term bucket.
import { describe, expect, it } from 'vitest';
import { generateTaxReport, getHarvestableLots, hasSameDayReentry } from '@/lib/taxCalculator';
import type { Transaction, Category } from '@/types/portfolio';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), symbol: 'TCS', type: 'BUY', quantity: 1, price: 1, date: daysAgo(0), ...overrides };
}

describe('generateTaxReport', () => {
  it('classifies a >365-day equity holding as long-term and a <365-day one as short-term', () => {
    const transactions: Transaction[] = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) }), // long-term
      txn({ type: 'BUY', quantity: 5, price: 300, date: daysAgo(10) }),   // short-term
    ];
    const report = generateTaxReport(transactions, { TCS: 150 }, { TCS: { category: 'Equity' } });

    expect(report.holdings).toHaveLength(1);
    const [h] = report.holdings;
    expect(h.totalQuantity).toBe(15);
    expect(h.totalInvested).toBe(2500); // 10*100 + 5*300
    expect(h.totalCurrentValue).toBe(2250); // 15*150
    expect(h.totalGain).toBe(-250);

    const ltLot = h.lots.find(l => l.isLongTerm);
    const stLot = h.lots.find(l => !l.isLongTerm);
    expect(ltLot?.gain).toBe(500);   // (150-100)*10
    expect(stLot?.gain).toBe(-750);  // (150-300)*5 — a loss, not taxed
    expect(stLot?.taxAmount).toBe(0);
  });

  it('consumes buy lots FIFO on a partial sell, leaving the remainder of the oldest lot', () => {
    const transactions: Transaction[] = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) }),
      txn({ type: 'BUY', quantity: 10, price: 150, date: daysAgo(200) }),
      txn({ type: 'SELL', quantity: 5, price: 999, date: daysAgo(50) }), // sell price is irrelevant to lot math here
    ];
    const report = generateTaxReport(transactions, { TCS: 200 }, { TCS: { category: 'Equity' } });
    const [h] = report.holdings;

    // FIFO: the 5 sold shares come out of the oldest (₹100) lot, leaving 5 @ ₹100 + 10 @ ₹150.
    expect(h.totalQuantity).toBe(15);
    const oldLot = h.lots.find(l => l.buyPrice === 100);
    const newLot = h.lots.find(l => l.buyPrice === 150);
    expect(oldLot?.quantity).toBe(5);
    expect(newLot?.quantity).toBe(10);
    expect(oldLot?.isLongTerm).toBe(true);  // ~400 days
    expect(newLot?.isLongTerm).toBe(false); // ~200 days
  });

  it('applies the ₹1.25L LTCG exemption only to equity-type categories, taxing the remainder at 12.5%', () => {
    const transactions: Transaction[] = [
      txn({ symbol: 'BIG', type: 'BUY', quantity: 100, price: 100, date: daysAgo(400) }),
    ];
    // Gain = (2100-100)*100 = 200,000 long-term. Exemption caps at 125,000 → taxable 75,000.
    const report = generateTaxReport(transactions, { BIG: 2100 }, { BIG: { category: 'Equity' } });

    expect(report.totalLTCG).toBe(200000);
    expect(report.ltcgExemption).toBe(125000);
    expect(report.taxableLTCG).toBe(75000);
    expect(report.ltcgTax).toBeCloseTo(9375, 5); // 75,000 * 0.125
    expect(report.cess).toBeCloseTo(375, 5);     // 9375 * 4%
    expect(report.totalTaxWithCess).toBeCloseTo(9750, 5);
  });

  it('does not apply the LTCG exemption to a non-equity category (e.g. Gold), and uses its 24-month threshold', () => {
    const transactions: Transaction[] = [
      // 400 days: long-term for equity (>365d) but still short-term for Gold (<730d).
      txn({ symbol: 'GOLDBEES', type: 'BUY', quantity: 10, price: 5000, date: daysAgo(400) }),
    ];
    const report = generateTaxReport(transactions, { GOLDBEES: 6000 }, { GOLDBEES: { category: 'Gold' } });
    const [h] = report.holdings;

    expect(h.lots[0].isLongTerm).toBe(false); // 400 < 730-day threshold for Gold
    expect(h.lots[0].taxRate).toBe(0.30);      // slab-rate STCG for non-equity
    expect(report.ltcgExemption).toBe(0);      // Gold gains never feed the equity exemption bucket
  });

  it('excludes a fully-sold-out symbol from the report', () => {
    const transactions: Transaction[] = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) }),
      txn({ type: 'SELL', quantity: 10, price: 200, date: daysAgo(1) }),
    ];
    const report = generateTaxReport(transactions, { TCS: 200 }, { TCS: { category: 'Equity' } });
    expect(report.holdings).toHaveLength(0);
    expect(report.totalTaxWithCess).toBe(0);
  });

  it('defaults to category "Equity" and price 0 when metadata/price are missing', () => {
    const transactions: Transaction[] = [txn({ type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) })];
    const report = generateTaxReport(transactions, {}, {});
    const [h] = report.holdings;
    expect(h.category).toBe('Equity');
    expect(h.totalCurrentValue).toBe(0); // missing price defaults to 0
    expect(h.totalGain).toBe(-1000);     // a full loss since current value is 0
  });
});

describe('getHarvestableLots', () => {
  it('returns only lots with a negative gain, sorted biggest loss first', () => {
    const transactions: Transaction[] = [
      txn({ symbol: 'WIN', type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) }),   // gain, excluded
      txn({ symbol: 'SMALL_LOSS', type: 'BUY', quantity: 10, price: 120, date: daysAgo(400) }), // -200 @ CMP 100
      txn({ symbol: 'BIG_LOSS', type: 'BUY', quantity: 10, price: 200, date: daysAgo(400) }),   // -1000 @ CMP 100
    ];
    const report = generateTaxReport(transactions, { WIN: 150, SMALL_LOSS: 100, BIG_LOSS: 100 }, {
      WIN: { category: 'Equity' }, SMALL_LOSS: { category: 'Equity' }, BIG_LOSS: { category: 'Equity' },
    });

    const harvestable = getHarvestableLots(report);
    expect(harvestable).toHaveLength(2);
    expect(harvestable.every(l => l.gain < 0)).toBe(true);
    expect(harvestable[0].symbol).toBe('BIG_LOSS');   // -1000, biggest loss first
    expect(harvestable[1].symbol).toBe('SMALL_LOSS'); // -200
  });

  it('returns an empty array when nothing is sitting at a loss', () => {
    const transactions: Transaction[] = [txn({ type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) })];
    const report = generateTaxReport(transactions, { TCS: 150 }, { TCS: { category: 'Equity' } });
    expect(getHarvestableLots(report)).toEqual([]);
  });
});

describe('hasSameDayReentry', () => {
  it('flags a symbol with a BUY and SELL on the same calendar day', () => {
    const transactions: Transaction[] = [
      txn({ symbol: 'TCS', type: 'SELL', quantity: 5, price: 100, date: '2026-03-01T09:00:00Z' }),
      txn({ symbol: 'TCS', type: 'BUY', quantity: 5, price: 101, date: '2026-03-01T15:00:00Z' }),
    ];
    expect(hasSameDayReentry('TCS', transactions)).toBe(true);
  });

  it('does not flag a BUY and SELL on different days', () => {
    const transactions: Transaction[] = [
      txn({ symbol: 'TCS', type: 'SELL', quantity: 5, price: 100, date: '2026-03-01T09:00:00Z' }),
      txn({ symbol: 'TCS', type: 'BUY', quantity: 5, price: 101, date: '2026-03-02T09:00:00Z' }),
    ];
    expect(hasSameDayReentry('TCS', transactions)).toBe(false);
  });

  it('ignores other symbols and a BUY-only or SELL-only day', () => {
    const transactions: Transaction[] = [
      txn({ symbol: 'TCS', type: 'BUY', quantity: 5, price: 100, date: '2026-03-01T09:00:00Z' }),
      txn({ symbol: 'INFY', type: 'SELL', quantity: 5, price: 100, date: '2026-03-01T10:00:00Z' }), // different symbol, same day
    ];
    expect(hasSameDayReentry('TCS', transactions)).toBe(false);
    expect(hasSameDayReentry('INFY', transactions)).toBe(false);
  });
});
