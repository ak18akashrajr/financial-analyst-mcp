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

const { computeWindowXIRR, computePortfolioWindowXIRR, hasFullTrailingWindow } = await import('@/pages/RollingReturns');

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
