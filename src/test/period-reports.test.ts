// Unit tests for the period-report primitives: FY period construction, snapshot pricing/cash
// resolution, and activity aggregation. See src/lib/periodReports.ts.
import { describe, expect, it } from 'vitest';
import {
  buildPeriods,
  periodStatus,
  calendarMonths,
  projectPeriod,
  buildSnapshot,
  buildActivity,
  fyStartYearFor,
  type HistoricalPriceMap,
  type NetWorthHistoryRow,
} from '@/lib/periodReports';
import type { Transaction, CashSettings, CurrentPrices } from '@/types/portfolio';

const ZERO_CASH: CashSettings = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), symbol: 'SYM', type: 'BUY', quantity: 1, price: 1, date: new Date().toISOString(), ...overrides };
}

describe('fyStartYearFor', () => {
  it('assigns a date on or after April 1 to that calendar year\'s FY', () => {
    expect(fyStartYearFor(new Date(2026, 3, 1))).toBe(2026);  // Apr 1
    expect(fyStartYearFor(new Date(2026, 7, 22))).toBe(2026); // Aug 22
    expect(fyStartYearFor(new Date(2027, 2, 31))).toBe(2026); // Mar 31 next calendar year, same FY
  });

  it('assigns a date before April 1 to the previous calendar year\'s FY', () => {
    expect(fyStartYearFor(new Date(2026, 0, 1))).toBe(2025);  // Jan 1
    expect(fyStartYearFor(new Date(2026, 2, 31))).toBe(2025); // Mar 31
  });

  it('round-trips with getFYStart', () => {
    for (const y of [2024, 2025, 2026]) {
      expect(fyStartYearFor(new Date(y, 3, 1))).toBe(y);
    }
  });
});

describe('buildPeriods', () => {
  it('builds 4 quarters spanning Apr(startYear) → Mar(startYear+1)', () => {
    const periods = buildPeriods(2026, 'quarter');
    expect(periods).toHaveLength(4);
    expect(periods.map(p => p.key)).toEqual(['FY2026-27-Q1', 'FY2026-27-Q2', 'FY2026-27-Q3', 'FY2026-27-Q4']);
    expect(periods[0].start).toEqual(new Date(2026, 3, 1));
    expect(periods[3].end).toEqual(new Date(2027, 3, 1));
    // Adjacent periods must be contiguous — no gaps or overlaps.
    for (let i = 0; i < periods.length - 1; i++) {
      expect(periods[i].end).toEqual(periods[i + 1].start);
    }
  });

  it('builds 2 halves and 1 full year for the same FY', () => {
    expect(buildPeriods(2026, 'half').map(p => p.key)).toEqual(['FY2026-27-H1', 'FY2026-27-H2']);
    const [fullYear] = buildPeriods(2026, 'year');
    expect(fullYear.key).toBe('FY2026-27-FY');
    expect(fullYear.start).toEqual(new Date(2026, 3, 1));
    expect(fullYear.end).toEqual(new Date(2027, 3, 1));
  });
});

describe('periodStatus', () => {
  const period = buildPeriods(2026, 'quarter')[1]; // Q2: Jul–Sep 2026

  it('is upcoming before it starts, in-progress during, and completed after it ends', () => {
    expect(periodStatus(period, new Date(2026, 5, 1))).toBe('upcoming');   // Jun 2026
    expect(periodStatus(period, new Date(2026, 7, 15))).toBe('in-progress'); // Aug 2026
    expect(periodStatus(period, new Date(2026, 9, 1))).toBe('completed');  // Oct 2026 (== end)
  });
});

describe('calendarMonths', () => {
  it('counts whole calendar months between two dates, end exclusive', () => {
    expect(calendarMonths(new Date(2026, 3, 1), new Date(2026, 6, 1))).toBe(3); // Apr → Jul
  });
  it('floors at 1 month even for a same-day range', () => {
    expect(calendarMonths(new Date(2026, 3, 1), new Date(2026, 3, 1))).toBe(1);
  });
});

describe('projectPeriod', () => {
  it('grows startValue by exactly the annual rate over exactly 12 months (monthly compounding round-trips)', () => {
    const result = projectPeriod(100000, 0, new Date(2026, 3, 1), new Date(2027, 3, 1), 0.10);
    expect(result.monthsAhead).toBe(12);
    expect(result.baseEndValue).toBeCloseTo(110000, 4);
    expect(result.conservativeRate).toBeCloseTo(0.08, 10); // 0.10 * 0.8
    expect(result.conservativeEndValue).toBeCloseTo(108000, 4);
  });

  it('falls back to fallbackRatePct when xirr is null', () => {
    const result = projectPeriod(100000, 0, new Date(2026, 3, 1), new Date(2027, 3, 1), null, 12);
    expect(result.baseRate).toBeCloseTo(0.12, 10);
  });
});

describe('buildSnapshot — price resolution', () => {
  const symbolMeta = { SYM: { category: 'Equity', geography: 'India' } };

  it('marks to the live price when useLive is true', () => {
    const transactions = [txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2026, 0, 1).toISOString() })];
    const snap = buildSnapshot(new Date(2026, 5, 1), transactions, { SYM: 150 }, symbolMeta, [], ZERO_CASH, { useLive: true });
    expect(snap.currentValue).toBe(1500);
    expect(snap.pnl).toBe(500);
    expect(snap.priceSources.SYM).toBe('live');
  });

  it('marks to the latest historical close at-or-before asOf when not live', () => {
    const transactions = [txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2024, 0, 1).toISOString() })];
    const historical: HistoricalPriceMap = { SYM: [{ date: '2024-01-01', close: 120 }, { date: '2024-06-01', close: 140 }] };
    const snap = buildSnapshot(new Date(2024, 2, 1), transactions, {}, symbolMeta, [], ZERO_CASH, { historicalPrices: historical });
    expect(snap.priceSources.SYM).toBe('historical');
    expect(snap.currentValue).toBe(1200); // 10 * 120 (the Jan close, not the later Jun one)
  });

  it('falls back to cost basis when there is no historical row and not live', () => {
    const transactions = [txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2024, 0, 1).toISOString() })];
    const snap = buildSnapshot(new Date(2024, 2, 1), transactions, { SYM: 999 }, symbolMeta, [], ZERO_CASH, {});
    expect(snap.priceSources.SYM).toBe('cost-fallback');
    expect(snap.currentValue).toBe(1000); // 10 * avgPrice(100), never the live 999
    expect(snap.pnl).toBe(0); // cost-fallback never fabricates a gain/loss
  });

  it('excludes transactions dated after asOf', () => {
    const transactions = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2024, 0, 1).toISOString() }),
      txn({ type: 'BUY', quantity: 10, price: 200, date: new Date(2025, 0, 1).toISOString() }), // in the future relative to asOf
    ];
    const snap = buildSnapshot(new Date(2024, 5, 1), transactions, { SYM: 150 }, symbolMeta, [], ZERO_CASH, { useLive: true });
    expect(snap.holdings[0].totalQuantity).toBe(10); // only the Jan-2024 buy counts
  });

  it('uses FIFO cost basis, not sell proceeds, for a partial sell (see src/lib/costBasis.ts)', () => {
    // Buy 10 @ ₹100, sell 5 @ ₹180. Old formula: invested = 1000 − (5×180) = 100,
    // avgPrice = ₹20 — inflated the remaining position's apparent gain. FIFO keeps
    // the 5 remaining shares costed at their original ₹100.
    const transactions = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2024, 0, 1).toISOString() }),
      txn({ type: 'SELL', quantity: 5, price: 180, date: new Date(2024, 1, 1).toISOString() }),
    ];
    const snap = buildSnapshot(new Date(2024, 5, 1), transactions, { SYM: 250 }, symbolMeta, [], ZERO_CASH, { useLive: true });
    expect(snap.holdings[0].totalQuantity).toBe(5);
    expect(snap.holdings[0].avgPrice).toBe(100);
    expect(snap.invested).toBe(500);
    expect(snap.pnl).toBe(750); // (250-100)*5, not the inflated (250-20)*5
  });
});

describe('buildSnapshot — period-only P&L (Reports.tsx "Unrealized P&L by Period" bar chart)', () => {
  // buildSnapshot's own `pnl` field is always all-time cumulative (since the earliest
  // transaction), never reset per period — Reports.tsx derives the period-only P&L shown
  // in that bar chart by subtracting two cumulative snapshots: pnl(period end) − pnl(period start).
  it('derives a period-only P&L that resets each quarter, from two cumulative snapshots', () => {
    const symbolMeta = { SYM: { category: 'Equity', geography: 'India' } };
    const transactions = [txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2026, 3, 15).toISOString() })]; // Q1 FY26-27
    const historical: HistoricalPriceMap = {
      SYM: [
        { date: '2026-06-29', close: 120 }, // last close before Q1 end (Jul 1, exclusive)
        { date: '2026-09-29', close: 150 }, // last close before Q2 end (Oct 1, exclusive)
      ],
    };
    // Use each period's actual (exclusive) end boundary, as Reports.tsx does — Q1 ends Jul 1, Q2 ends Oct 1.
    const q1End = buildSnapshot(new Date(2026, 6, 1), transactions, {}, symbolMeta, [], ZERO_CASH, { historicalPrices: historical });
    const q2End = buildSnapshot(new Date(2026, 9, 1), transactions, {}, symbolMeta, [], ZERO_CASH, { historicalPrices: historical });

    // Cumulative pnl keeps growing across periods — it does NOT reset on its own.
    expect(q1End.pnl).toBe(200);  // (120 - 100) * 10
    expect(q2End.pnl).toBe(500);  // (150 - 100) * 10

    // Period-only P&L for Q2 = cumulative(Q2 end) − cumulative(Q1 end), i.e. the price
    // move within Q2 alone ((150 - 120) * 10), not the all-time total.
    const q2PeriodOnlyPnl = q2End.pnl - q1End.pnl;
    expect(q2PeriodOnlyPnl).toBe(300);
  });
});

describe('buildSnapshot — cash resolution', () => {
  const netWorthHistory: NetWorthHistoryRow[] = [
    { recorded_at: '2024-01-01', net_worth: 0, portfolio_value: 0, liquid_cash: 1000, vault_cash: 2000, pf_balance: 500, credit_card_debt: 0 },
    { recorded_at: '2024-06-01', net_worth: 0, portfolio_value: 0, liquid_cash: 1500, vault_cash: 2500, pf_balance: 500, credit_card_debt: 0 },
  ];
  const liveCash: CashSettings = { liquidCash: 9999, vaultCash: 9999, pfBalance: 9999, creditCardDebt: 0 };

  it('uses the nearest net-worth snapshot at-or-before asOf, never a later one', () => {
    const snap = buildSnapshot(new Date(2024, 3, 1), [], {}, {}, netWorthHistory, liveCash);
    expect(snap.cashSource).toBe('history');
    expect(snap.liquidCash).toBe(1000); // Jan row, not the later Jun row
  });

  it('falls back to live cash only when useLive is set and no history exists yet', () => {
    const snap = buildSnapshot(new Date(2023, 0, 1), [], {}, {}, netWorthHistory, liveCash, { useLive: true });
    expect(snap.cashSource).toBe('live');
    expect(snap.liquidCash).toBe(9999);
  });

  it('never blends live cash into a past period when useLive is false', () => {
    const snap = buildSnapshot(new Date(2023, 0, 1), [], {}, {}, netWorthHistory, liveCash, { useLive: false });
    expect(snap.cashSource).toBe('none');
    expect(snap.liquidCash).toBe(0);
  });
});

describe('buildActivity', () => {
  it('only counts transactions inside [period.start, period.end)', () => {
    const period = buildPeriods(2026, 'quarter')[0]; // Q1: Apr–Jun 2026
    const transactions = [
      txn({ type: 'BUY', quantity: 10, price: 100, date: new Date(2026, 3, 15).toISOString() }),  // inside
      txn({ type: 'SELL', quantity: 5, price: 120, date: new Date(2026, 4, 1).toISOString() }),     // inside
      txn({ type: 'BUY', quantity: 1, price: 100, date: new Date(2026, 6, 1).toISOString() }),      // after period.end — excluded
    ];
    const dummySnapshot = buildSnapshot(new Date(2026, 5, 30), transactions, {}, {}, [], ZERO_CASH);
    const activity = buildActivity(period, transactions, dummySnapshot);
    expect(activity.buyCount).toBe(1);
    expect(activity.sellCount).toBe(1);
    expect(activity.buyValue).toBe(1000);
    expect(activity.sellValue).toBe(600);
    expect(activity.netInvested).toBe(400);
    expect(activity.uniqueSymbols).toBe(1); // both transactions are 'SYM'
  });
});
