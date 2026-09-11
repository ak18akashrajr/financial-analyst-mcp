// Covers the DATE-boundary bug flagged in TODO.md's High Priority Action Items for
// src/pages/GoalTrack.tsx's getHoldingLotSplit (used by computeAllocTax to split a symbol
// allocation's invested cost into long-term/short-term for its post-tax progress figure).
// getOpenLots built each lot's `date` with bare `new Date(t.date)`, where t.date is a bare
// Postgres DATE string ('YYYY-MM-DD', no time/offset) — JS parses that as UTC midnight, a
// different (later) instant than local midnight in a timezone ahead of UTC (this suite runs
// under Asia/Calcutta, UTC+5:30). That inflates the computed age deficit and can flip a lot
// sitting within that margin of the 365-day LT/ST threshold from long-term to short-term —
// same bug class as taxCalculator.ts (see tax-calculator.test.ts), fixed the same way with
// parseLocalDate. Guard so the assertion doesn't misfire if CI ever runs in UTC — same
// convention as dateUtils.test.ts.
//
// Follows goal-track-max-sync.test.ts's convention: exercise the page's pure allocation-math
// exports directly rather than rendering the page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAllocTax, type Allocation } from '@/pages/GoalTrack';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

// GoalTrack.tsx imports the real supabase client at module scope, which throws without env vars —
// stub it out (vi.mock calls are hoisted above imports by vitest) since this file only exercises
// the page's pure allocation-math exports.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

function holding(overrides: Partial<DerivedHolding> & { symbol: string; totalQuantity: number; transactions: Transaction[] }): DerivedHolding {
  return {
    avgPrice: 100,
    currentPrice: 150,
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
    symbol: 'TCS',
    amount: 0,
    quantity: 0,
    track_max: false,
    ...overrides,
  };
}

describe('computeAllocTax — getHoldingLotSplit DATE-boundary handling (see TODO.md High Priority Action Items)', () => {
  afterEach(() => vi.useRealTimers());

  it('classifies a lot exactly 365 calendar days old as long-term, not short-term', () => {
    const offsetMinutes = -new Date().getTimezoneOffset(); // e.g. +330 for IST
    if (offsetMinutes <= 0) return;

    // "Now" is 1 minute after local midnight, and the lone BUY lot is exactly 365 local calendar
    // days before that midnight — so the correct (local-midnight) ageDays is just barely >= 365
    // (long-term). The buggy UTC-midnight parse of '2026-01-02' lands `offsetMinutes` later than
    // local midnight, which (for any zone at least 2 minutes ahead of UTC — every real one) pulls
    // ageDays back below 365 (short-term).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 0, 2, 0, 1, 0));

    const transactions: Transaction[] = [
      { id: 't1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2026-01-02' },
    ];
    const h = holding({ symbol: 'TCS', totalQuantity: 10, transactions });
    const a = alloc({ id: 'a1', symbol: 'TCS', quantity: 10, track_max: false });

    const r = computeAllocTax(a, [h], {}, [a]);

    // Gain is (150-100)*10 = 500. All-long-term (fixed) puts it entirely in gainLT; the
    // misclassification bug would instead put it entirely in gainST, taxed at 20% instead of 12.5%.
    expect(r.gainLT).toBe(500);
    expect(r.gainST).toBe(0);
    expect(r.taxLT).toBeCloseTo(62.5, 5);  // 500 * 12.5%
    expect(r.taxST).toBe(0);
  });
});
