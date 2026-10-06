// Unit tests for generateTaxReport (FIFO tax-lot computation + LTCG exemption). See
// src/lib/taxCalculator.ts. Dates are expressed relative to `Date.now()` rather than fixed
// calendar dates, since the module reads `new Date()` internally for "today" — a fixed date
// would eventually drift into the wrong long-term/short-term bucket.
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('does not apply the LTCG exemption to a non-equity category (e.g. Real Estate), and uses its 24-month threshold', () => {
    const transactions: Transaction[] = [
      // 400 days: long-term for equity (>365d) but still short-term for Real Estate (<730d).
      txn({ symbol: 'PLOT', type: 'BUY', quantity: 10, price: 5000, date: daysAgo(400) }),
    ];
    const report = generateTaxReport(transactions, { PLOT: 6000 }, { PLOT: { category: 'Real Estate' } });
    const [h] = report.holdings;

    expect(h.lots[0].isLongTerm).toBe(false); // 400 < 730-day threshold for Real Estate
    expect(h.lots[0].taxRate).toBe(0.30);      // slab-rate STCG for non-equity
    expect(report.ltcgExemption).toBe(0);      // non-equity gains never feed the equity exemption bucket
  });

  it("treats category 'Stocks' like listed equity: 12-month threshold, 20% STCG, LTCG exemption (audit H5)", () => {
    // 'Stocks' is the first option in the HoldingsTable category picker but had no case in the
    // threshold/rate switches, so it fell to the 24-month / 30% default.
    const transactions: Transaction[] = [
      txn({ symbol: 'LT', type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) }), // long-term
      txn({ symbol: 'ST', type: 'BUY', quantity: 10, price: 100, date: daysAgo(100) }), // short-term
    ];
    const report = generateTaxReport(
      transactions,
      { LT: 1100, ST: 1100 },
      { LT: { category: 'Stocks' }, ST: { category: 'Stocks' } },
    );
    const lt = report.holdings.find(h => h.symbol === 'LT')!.lots[0];
    const st = report.holdings.find(h => h.symbol === 'ST')!.lots[0];

    expect(lt.isLongTerm).toBe(true); // 400 > 365 (was short-term under the 730-day default)
    expect(lt.taxRate).toBe(0.125);
    expect(st.isLongTerm).toBe(false);
    expect(st.taxRate).toBe(0.20); // not the 30% default
    // LT gain 10,000 sits fully inside the ₹1.25L exemption → no LTCG tax.
    expect(report.totalLTCG).toBe(10000);
    expect(report.ltcgExemption).toBe(10000);
    expect(report.ltcgTax).toBe(0);
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

describe('generateTaxReport — DATE-boundary handling (see TODO.md High Priority Action Items)', () => {
  // lot.date comes straight from transactions.date, a bare Postgres DATE string ('YYYY-MM-DD', no
  // time/offset). Before the fix, computeLotsForSymbol parsed it with bare `new Date(lot.date)`,
  // which JS reads as UTC midnight — later than local midnight in a timezone ahead of UTC (this
  // suite runs under Asia/Calcutta, UTC+5:30). That undercounts holdingDays by the local/UTC
  // offset, which can flip isLongTerm for a lot sitting within that margin of the 365-day
  // threshold. Guard so the assertion doesn't misfire if CI ever runs in UTC — same convention as
  // dateUtils.test.ts.
  afterEach(() => vi.useRealTimers());

  it('classifies a lot exactly 366 calendar days old as long-term, not short-term', () => {
    const offsetMinutes = -new Date().getTimezoneOffset(); // e.g. +330 for IST
    if (offsetMinutes <= 0) return;

    // "Now" is 1 minute after local midnight, and the buy lot is exactly 366 local calendar days
    // before that midnight — so the correct (local-midnight) holdingDays floors to 366 (> 365,
    // long-term) regardless of the 1-minute margin. The buggy UTC-midnight parse of '2026-01-01'
    // lands `offsetMinutes` later than local midnight, which (for any zone at least 2 minutes
    // ahead of UTC — every real one) pulls holdingDays back down to 365 (not > 365, short-term).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 0, 2, 0, 1, 0));

    const transactions: Transaction[] = [txn({ type: 'BUY', quantity: 10, price: 100, date: '2026-01-01' })];
    const report = generateTaxReport(transactions, { TCS: 150 }, { TCS: { category: 'Equity' } });
    const [h] = report.holdings;

    expect(h.lots[0].holdingDays).toBe(366);
    expect(h.lots[0].isLongTerm).toBe(true);
    expect(h.lots[0].taxRate).toBe(0.125); // LTCG, not the 20% STCG rate a misclassification would apply
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

// Per-category rules (audit H5, remaining categories) — decided from the owner's tax table: listed Gold/Silver
// ETFs and listed bonds are 12 months; US stocks / real estate / custom assets 24 months; crypto a flat 30%
// with no long-term class; FDs / PF / NPS have no capital-gains treatment and are excluded with a note.
describe('generateTaxReport — category rules (audit H5)', () => {
  const one = (category: Category, ageDays: number, price = 100, current = 150) => {
    const report = generateTaxReport(
      [txn({ symbol: 'X', type: 'BUY', quantity: 10, price, date: daysAgo(ageDays) })],
      { X: current },
      { X: { category } },
    );
    return { report, lot: report.holdings[0]?.lots[0] };
  };

  it.each<[Category]>([['Gold'], ['Gold & Silver'], ['Bonds']])(
    '%s is long-term after 12 months at 12.5%, with no LTCG exemption',
    (category) => {
      const lt = one(category, 400);
      expect(lt.lot.isLongTerm).toBe(true);
      expect(lt.lot.taxRate).toBe(0.125);
      expect(lt.report.ltcgExemption).toBe(0);

      const st = one(category, 300);
      expect(st.lot.isLongTerm).toBe(false);
      expect(st.lot.taxRate).toBe(0.30); // slab-rate estimate
    },
  );

  it.each<[Category]>([['US Stocks / ETFs'], ['Real Estate'], ['Custom Assets']])(
    '%s stays on the 24-month rule (long-term only after 730 days, 12.5%, no exemption)',
    (category) => {
      expect(one(category, 400).lot.isLongTerm).toBe(false);
      expect(one(category, 400).lot.taxRate).toBe(0.30);
      const lt = one(category, 800);
      expect(lt.lot.isLongTerm).toBe(true);
      expect(lt.lot.taxRate).toBe(0.125);
      expect(lt.report.ltcgExemption).toBe(0);
    },
  );

  it('taxes crypto at a flat 30% no matter how long it was held (a 3-year-old lot is not 12.5%)', () => {
    // 10 units bought at 100,000, now 120,000: gain 200,000 held ~3 years.
    const { report, lot } = one('Crypto', 1100, 100_000, 120_000);

    expect(lot.isLongTerm).toBe(false); // there is no long-term class
    expect(lot.taxRate).toBe(0.30);
    expect(lot.taxAmount).toBeCloseTo(60_000, 6); // not 25,000
    expect(report.totalLTCG).toBe(0);
    expect(report.ltcgTax).toBe(0);
    expect(report.stcgTax).toBeCloseTo(60_000, 6);
  });

  it("never lets a crypto loss reduce another asset's tax (no set-off)", () => {
    const report = generateTaxReport(
      [
        txn({ symbol: 'COIN', type: 'BUY', quantity: 10, price: 100, date: daysAgo(500) }), // −500 loss
        txn({ symbol: 'ETF', type: 'BUY', quantity: 10, price: 100, date: daysAgo(100) }), // +500 gain, short-term
      ],
      { COIN: 50, ETF: 150 },
      { COIN: { category: 'Crypto' }, ETF: { category: 'Equity' } },
    );
    expect(report.stcgTax).toBeCloseTo(500 * 0.2, 6); // only the equity gain, untouched by the crypto loss
  });

  it.each<[Category]>([['Fixed Deposits'], ['FDs'], ['PPF / EPF'], ['NPS']])(
    '%s has no capital-gains treatment: left out of the report and listed with a reason',
    (category) => {
      const { report } = one(category, 800, 100, 150);

      expect(report.holdings).toHaveLength(0);
      expect(report.totalTaxWithCess).toBe(0);
      expect(report.excluded).toHaveLength(1);
      expect(report.excluded[0]).toMatchObject({ symbol: 'X', category });
      expect(report.excluded[0].reason.length).toBeGreaterThan(10);
    },
  );

  it('keeps taxable holdings in the totals while excluding an FD held alongside them', () => {
    const report = generateTaxReport(
      [
        txn({ symbol: 'EQ', type: 'BUY', quantity: 10, price: 100, date: daysAgo(100) }),
        txn({ symbol: 'FD1', type: 'BUY', quantity: 1, price: 100_000, date: daysAgo(100) }),
      ],
      { EQ: 150, FD1: 108_000 },
      { EQ: { category: 'Equity' }, FD1: { category: 'Fixed Deposits' } },
    );
    expect(report.holdings.map(h => h.symbol)).toEqual(['EQ']);
    expect(report.totalSTCG).toBe(500); // the FD's ₹8,000 is not counted as a capital gain
    expect(report.excluded.map(e => e.symbol)).toEqual(['FD1']);
  });

  it('does not list a fully-sold excluded holding as a current holding', () => {
    const report = generateTaxReport(
      [
        txn({ symbol: 'FD1', type: 'BUY', quantity: 1, price: 100, date: daysAgo(500) }),
        txn({ symbol: 'FD1', type: 'SELL', quantity: 1, price: 108, date: daysAgo(10) }),
      ],
      { FD1: 108 },
      { FD1: { category: 'Fixed Deposits' } },
    );
    expect(report.excluded).toEqual([]);
  });
});
