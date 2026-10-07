// Covers the DATE-boundary bug flagged in TODO.md's timezone-date-boundary-bug item:
// computeWindowXIRR / computePortfolioWindowXIRR (src/pages/RollingReturns.tsx) compare
// transaction/price DATE-only strings ('YYYY-MM-DD', from transactions.date and
// historical_prices.date) against a genuinely local-instant window boundary (`start`/`windowEnd`,
// built with `new Date(windowEnd)` + setFullYear, or plain `new Date()`). Parsing the DATE-only
// side with bare `new Date(dateStr)` reads it as UTC midnight — later than local midnight in a
// timezone ahead of UTC (verified under IST, UTC+5:30) — which can wrongly exclude a
// transaction/price dated exactly on the window's start/end boundary. Fixed by parsing those
// strings with `parseLocalDate` instead, matching the locally-built boundary Dates.
import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/types/portfolio';

// RollingReturns.tsx transitively imports the supabase client (via usePortfolio and its own
// historical_prices queries), which throws at module load without real env vars. These tests only
// need the two pure, exported calculation functions — stub the client so the import doesn't blow up.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) },
}));

const {
  computeWindowXIRR,
  computePortfolioWindowXIRR,
  hasFullTrailingWindow,
  gatedWindowXIRR,
  gatedPortfolioWindowXIRR,
} = await import('@/pages/RollingReturns');

function txn(overrides: Partial<Transaction>): Transaction {
  return { id: 'x', symbol: 'AAPL', type: 'BUY', quantity: 1, price: 100, date: '2023-01-01', ...overrides };
}

describe('computeWindowXIRR — DATE-boundary handling', () => {
  it('includes a BUY transaction dated exactly on the window start boundary (IST)', () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    if (offsetMinutes <= 0) return; // only meaningful in a timezone ahead of UTC (suite runs under IST)

    // Window: 1 year back from 2024-01-01 local midnight -> start = 2023-01-01 local midnight.
    // The BUY sits exactly on that start boundary. Under the old bare `new Date(t.date)` parse,
    // '2023-01-01' becomes UTC midnight — LATER than local midnight `start` in IST — so the
    // transaction would look like it happened *after* start and be wrongly excluded from
    // "quantity held at window start", along with its matching cash flow.
    const windowEnd = new Date(2024, 0, 1);
    const txns: Transaction[] = [txn({ type: 'BUY', date: '2023-01-01', quantity: 10, price: 100 })];
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];

    const result = computeWindowXIRR('AAPL', txns, prices, windowEnd, 1);

    // A flat 1000 -> 1100 over exactly 1 year is the textbook 10% XIRR case (see xirr.test.ts).
    // If the boundary transaction were dropped, qtyAtStart would be 0, there'd be no open-position
    // outflow and no in-window BUY inflow either (same bug drops it there too) — cashFlows would
    // have < 2 entries and this would return null instead of ~10%.
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1, 2);
  });

  it('excludes a BUY genuinely dated after the window start', () => {
    const windowEnd = new Date(2024, 0, 1);
    const txns: Transaction[] = [txn({ type: 'BUY', date: '2023-06-01', quantity: 10, price: 100 })];
    const prices = [
      { date: '2023-01-01', close: 90 },
      { date: '2023-06-01', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];
    const result = computeWindowXIRR('AAPL', txns, prices, windowEnd, 1);
    expect(result).not.toBeNull();
  });
});

describe('computePortfolioWindowXIRR — DATE-boundary handling', () => {
  it('includes a holding whose only BUY sits exactly on the window start boundary (IST)', () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    if (offsetMinutes <= 0) return;

    const windowEnd = new Date(2024, 0, 1);
    const transactions: Transaction[] = [txn({ type: 'BUY', date: '2023-01-01', quantity: 10, price: 100 })];
    const pricesBySymbol = {
      AAPL: [
        { date: '2023-01-01', close: 100 },
        { date: '2024-01-01', close: 110 },
      ],
    };

    const result = computePortfolioWindowXIRR(transactions, pricesBySymbol, windowEnd, 1);

    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1, 2);
  });

  it('prices a same-day-boundary holding using the price dated exactly on windowEnd, not a stale earlier one', () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    if (offsetMinutes <= 0) return;

    const windowEnd = new Date(2024, 0, 1);
    const transactions: Transaction[] = [txn({ type: 'BUY', date: '2023-01-01', quantity: 10, price: 100 })];
    const pricesBySymbol = {
      // A stale price the bug would fall back to if the windowEnd-dated price were misparsed as
      // "after" windowEnd and filtered out.
      AAPL: [
        { date: '2023-01-01', close: 100 },
        { date: '2023-06-01', close: 50 },
        { date: '2024-01-01', close: 110 },
      ],
    };

    const result = computePortfolioWindowXIRR(transactions, pricesBySymbol, windowEnd, 1);

    // Correct terminal value uses the 110 close on windowEnd itself, giving ~10% XIRR, not the
    // deeply negative return a stale 50 close would produce.
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1, 2);
  });
});

// Covers the "rolling returns chart shows irrelevant data" bug: near portfolio inception, a
// window's start (windowEnd - yearsBack) predates the earliest transaction, so the real holding
// period inside the window is much shorter than yearsBack. computeWindowXIRR/
// computePortfolioWindowXIRR still return a mathematically valid XIRR for that shorter period,
// but annualized as if it were a full yearsBack window it explodes into extreme, meaningless
// values (e.g. thousands of percent for a few weeks' gain). hasFullTrailingWindow lets the chart
// skip those points instead of plotting them.
describe('hasFullTrailingWindow', () => {
  it('is false with no transactions', () => {
    expect(hasFullTrailingWindow([], new Date(2024, 0, 1), 1)).toBe(false);
  });

  it('is false when the earliest transaction is after the window start (partial window)', () => {
    // windowEnd - 1y = 2023-01-01; earliest txn 2023-06-01 is after that -> not a full window yet.
    const txns = [{ date: '2023-06-01' }];
    expect(hasFullTrailingWindow(txns, new Date(2024, 0, 1), 1)).toBe(false);
  });

  it('is true when the earliest transaction is exactly on the window start boundary', () => {
    const txns = [{ date: '2023-01-01' }];
    expect(hasFullTrailingWindow(txns, new Date(2024, 0, 1), 1)).toBe(true);
  });

  it('is true when the earliest transaction predates the window start', () => {
    const txns = [{ date: '2020-01-01' }, { date: '2023-06-01' }];
    expect(hasFullTrailingWindow(txns, new Date(2024, 0, 1), 1)).toBe(true);
  });
});

// Audit M6a: units already held at window start need a start price to be costed. With none, computeWindowXIRR
// used to skip the opening outflow but still count ALL units at the end, so pre-window units looked free.
describe('computeWindowXIRR — missing start price (audit M6)', () => {
  const windowEnd = new Date(2024, 0, 1); // 1Y window starts 2023-01-01

  it('returns null instead of treating units held before the window as free', () => {
    const txns: Transaction[] = [
      txn({ type: 'BUY', date: '2022-01-01', quantity: 10, price: 100 }), // held at window start
      txn({ type: 'BUY', date: '2023-07-01', quantity: 5, price: 120 }), // in-window buy: the only outflow
    ];
    // Price history only begins mid-window, so there is no price on or before the 2023-01-01 start.
    const prices = [
      { date: '2023-07-01', close: 120 },
      { date: '2024-01-01', close: 130 },
    ];
    // Old behaviour: flows were just -600 (the in-window buy) and +1950 (all 15 units) -> a ~500% annualised
    // "return", because the 10 pre-window units cost nothing.
    expect(computeWindowXIRR('AAPL', txns, prices, windowEnd, 1)).toBeNull();
  });

  it('still computes normally when a start price exists', () => {
    const txns: Transaction[] = [txn({ type: 'BUY', date: '2022-01-01', quantity: 10, price: 100 })];
    const prices = [
      { date: '2022-12-30', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];
    const r = computeWindowXIRR('AAPL', txns, prices, windowEnd, 1);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 2);
  });

  it('is unaffected when nothing was held at window start (no start price needed)', () => {
    const txns: Transaction[] = [txn({ type: 'BUY', date: '2023-06-01', quantity: 10, price: 100 })];
    const prices = [
      { date: '2023-06-01', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];
    expect(computeWindowXIRR('AAPL', txns, prices, windowEnd, 1)).not.toBeNull();
  });
});

// Audit M6b: the summary table's 1Y/3Y/5Y columns must not report a partial window's XIRR as a 1Y/3Y/5Y figure.
describe('gated window XIRR for the summary table (audit M6)', () => {
  const windowEnd = new Date(2024, 0, 1);
  // A position only ~4 months old (2023-09-01 .. 2024-01-01 = 122 days), up 10%.
  const young: Transaction[] = [txn({ type: 'BUY', date: '2023-09-01', quantity: 10, price: 100 })];
  const prices = [
    { date: '2023-09-01', close: 100 },
    { date: '2024-01-01', close: 110 },
  ];

  it('shows a number for the ungated function but null for 1Y/3Y/5Y once gated', () => {
    // The ungated function annualises the real 122-day holding period into a big, meaningless figure ...
    expect(computeWindowXIRR('AAPL', young, prices, windowEnd, 1)).not.toBeNull();
    // ... which the table used to print under every column. Gated, none of the trailing windows is available.
    for (const years of [1, 3, 5]) {
      expect(gatedWindowXIRR('AAPL', young, prices, windowEnd, years)).toBeNull();
    }
  });

  it('returns the real figure once the position has a full window of history', () => {
    const old: Transaction[] = [txn({ type: 'BUY', date: '2022-12-01', quantity: 10, price: 100 })];
    const p = [
      { date: '2022-12-01', close: 100 },
      { date: '2023-01-01', close: 100 },
      { date: '2024-01-01', close: 110 },
    ];
    const r = gatedWindowXIRR('AAPL', old, p, windowEnd, 1);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 2);
    // ... but 3Y still isn't available: only ~13 months of history.
    expect(gatedWindowXIRR('AAPL', old, p, windowEnd, 3)).toBeNull();
  });

  it('gates the portfolio row on the earliest transaction across all symbols', () => {
    const txns: Transaction[] = [
      txn({ symbol: 'AAA', type: 'BUY', date: '2023-09-01', quantity: 10, price: 100 }),
      txn({ symbol: 'BBB', type: 'BUY', date: '2021-01-01', quantity: 10, price: 100 }), // pushes history back
    ];
    const pbs = {
      AAA: [{ date: '2023-01-01', close: 100 }, { date: '2024-01-01', close: 110 }],
      BBB: [{ date: '2023-01-01', close: 100 }, { date: '2024-01-01', close: 110 }],
    };
    expect(gatedPortfolioWindowXIRR(txns, pbs, windowEnd, 1)).not.toBeNull(); // BBB gives >1Y of history
    expect(gatedPortfolioWindowXIRR(txns, pbs, windowEnd, 5)).toBeNull(); // but not 5Y
    expect(gatedPortfolioWindowXIRR(young, { AAPL: prices }, windowEnd, 1)).toBeNull(); // a young portfolio: none
  });

  it('is null with no transactions', () => {
    expect(gatedPortfolioWindowXIRR([], {}, windowEnd, 1)).toBeNull();
    expect(gatedWindowXIRR('AAPL', [], [], windowEnd, 1)).toBeNull();
  });
});
