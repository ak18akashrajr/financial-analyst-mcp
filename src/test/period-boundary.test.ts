// Period-end boundary fix. PeriodDef.end is EXCLUSIVE (midnight at the start of the next period), but
// buildSnapshot treats `asOf` as inclusive of that whole calendar day. Measuring a completed period at
// `p.end` therefore pulled the next period's FIRST-DAY trades and closing price into its close (and
// `p.start` pulled them into the opening point). periodOpeningAsOf / periodClosingAsOf measure at the
// last instant of the previous day instead, so every day lands in exactly one period.
import { describe, expect, it } from 'vitest';
import {
  buildActivity,
  buildPeriods,
  buildSnapshot,
  periodClosingAsOf,
  periodOpeningAsOf,
  periodStatus,
  type HistoricalPriceMap,
  type NetWorthHistoryRow,
} from '@/lib/periodReports';
import { buildPeriodBridge } from '@/lib/netWorthMovement';
import type { Transaction } from '@/types/portfolio';

const [, q2, q3] = buildPeriods(2026, 'quarter'); // Q2: Jul 1 → Oct 1, Q3: Oct 1 → Jan 1
const cash = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();

describe('period measurement points', () => {
  it('opens a period at the last instant of the previous day, i.e. where the previous period closed', () => {
    const periods = buildPeriods(2026, 'quarter');
    for (let i = 1; i < periods.length; i++) {
      expect(periodOpeningAsOf(periods[i]).getTime()).toBe(periodClosingAsOf(periods[i - 1], 'completed').getTime());
    }
    expect(periodOpeningAsOf(q3)).toEqual(new Date(2026, 8, 30, 23, 59, 59, 999));
  });

  it("closes a completed period at its own last instant, not at the next period's midnight", () => {
    expect(periodClosingAsOf(q2, 'completed')).toEqual(new Date(2026, 8, 30, 23, 59, 59, 999));
  });

  it('closes an in-progress period at "now" and an upcoming one where it opens', () => {
    const now = new Date(2026, 10, 15, 9);
    expect(periodClosingAsOf(q3, 'in-progress', now)).toBe(now);
    expect(periodClosingAsOf(q3, 'upcoming')).toEqual(periodOpeningAsOf(q3));
  });

  it('works for half-years and full years too', () => {
    const [h1, h2] = buildPeriods(2026, 'half');
    expect(periodClosingAsOf(h1, 'completed').getTime()).toBe(periodOpeningAsOf(h2).getTime());
    const [fy] = buildPeriods(2026, 'year');
    expect(periodClosingAsOf(fy, 'completed')).toEqual(new Date(2027, 2, 31, 23, 59, 59, 999));
  });
});

describe('first-day-of-next-period data no longer leaks into the earlier period', () => {
  // Q2 (Jul–Sep) and Q3 (Oct–Dec). One holding bought before Q2, one more buy on Oct 1 — the first day of Q3.
  const txs: Transaction[] = [
    { id: '1', symbol: 'SYM', type: 'BUY', quantity: 10, price: 100, date: '2026-04-15' },
    { id: '2', symbol: 'SYM', type: 'BUY', quantity: 10, price: 100, date: '2026-10-01' },
  ];
  const hist: HistoricalPriceMap = {
    SYM: [
      { date: '2026-06-30', close: 110 },
      { date: '2026-09-30', close: 120 }, // Q2's real last close
      { date: '2026-10-01', close: 130 }, // Q3's FIRST close — must not be used for Q2
      { date: '2026-12-31', close: 150 },
    ],
  };
  const snap = (asOf: Date, history: NetWorthHistoryRow[] = []) =>
    buildSnapshot(asOf, txs, {}, {}, history, cash, { historicalPrices: hist });

  it('values Q2 at its own last close and without the Oct 1 trade', () => {
    const q2Close = snap(periodClosingAsOf(q2, 'completed'));
    expect(q2Close.holdings[0].totalQuantity).toBe(10); // not 20
    expect(q2Close.currentValue).toBe(1200); // 10 × ₹120 (Sep 30), not 20 × ₹130 = 2,600
  });

  it('shows what the old p.end measurement did, so the regression is visible', () => {
    const old = snap(q2.end);
    expect(old.holdings[0].totalQuantity).toBe(20);
    expect(old.currentValue).toBe(2600);
  });

  it('puts the Oct 1 trade and the Oct 1 price move into Q3, and Q3 opens exactly where Q2 closed', () => {
    const q2Close = snap(periodClosingAsOf(q2, 'completed'));
    const q3Open = snap(periodOpeningAsOf(q3));
    expect(q3Open.netWorth).toBe(q2Close.netWorth);

    const q3Close = snap(periodClosingAsOf(q3, 'completed'));
    const bridge = buildPeriodBridge(q3Open, q3Close, txs);
    expect(bridge.openingNetWorth).toBe(1200);
    expect(bridge.closingNetWorth).toBe(3000); // 20 × ₹150
    expect(bridge.rows.find((r) => r.key === 'newMoney')!.amount).toBe(1000); // the Oct 1 buy: 10 × 100
    // Price movement: 10 old shares 120→150 (+300) and 10 new shares bought at 100 → 150 (+500).
    expect(bridge.rows.find((r) => r.key === 'priceMovement')!.amount).toBe(800);
    expect(bridge.change).toBe(1800);
  });

  it("makes the bridge's new money agree with the Activity card for the same period", () => {
    const q3Open = snap(periodOpeningAsOf(q3));
    const q3Close = snap(periodClosingAsOf(q3, 'completed'));
    const bridge = buildPeriodBridge(q3Open, q3Close, txs);
    // buildActivity counts [start, end) by trade date; before the fix the bridge window disagreed on the boundary day.
    expect(bridge.flow.net).toBe(buildActivity(q3, txs, q3Close).netInvested);
    const q2Bridge = buildPeriodBridge(snap(periodOpeningAsOf(q2)), snap(periodClosingAsOf(q2, 'completed')), txs);
    expect(q2Bridge.flow.net).toBe(buildActivity(q2, txs, snap(periodClosingAsOf(q2, 'completed'))).netInvested);
  });
});

describe('balance snapshots across the boundary', () => {
  const row = (recorded_at: string, vault: number): NetWorthHistoryRow => ({
    recorded_at, net_worth: 0, portfolio_value: 0, liquid_cash: 0, vault_cash: vault, pf_balance: 0, credit_card_debt: 0,
  });
  const history = [
    row(at(2026, 9, 30, 18), 90_000), // Sep 30 evening — belongs to Q2
    row(at(2026, 10, 1, 10), 150_000), // Oct 1 morning — belongs to Q3
  ];

  it('counts a Sep 30 edit in Q2 and an Oct 1 edit in Q3 only (the reported scenario)', () => {
    const q2Close = buildSnapshot(periodClosingAsOf(q2, 'completed'), [], {}, {}, history, cash);
    expect(q2Close.vaultCash).toBe(90_000);
    const q3Open = buildSnapshot(periodOpeningAsOf(q3), [], {}, {}, history, cash);
    expect(q3Open.vaultCash).toBe(90_000);
    const q3Close = buildSnapshot(periodClosingAsOf(q3, 'completed'), [], {}, {}, history, cash);
    expect(q3Close.vaultCash).toBe(150_000);

    const bridge = buildPeriodBridge(q3Open, q3Close, []);
    expect(bridge.rows.find((r) => r.key === 'vaultCash')!.amount).toBe(60_000);
  });

  it('does not change how balance edits were already treated at the boundary', () => {
    // Old measurement (p.end) also excluded the Oct 1 10:00 edit from Q2 — cash was never affected.
    expect(buildSnapshot(q2.end, [], {}, {}, history, cash).vaultCash).toBe(90_000);
  });
});

describe('period status is unchanged', () => {
  it('still treats the exclusive end as the moment a period becomes completed', () => {
    expect(periodStatus(q2, new Date(2026, 8, 30, 23, 59))).toBe('in-progress');
    expect(periodStatus(q2, new Date(2026, 9, 1, 0, 0))).toBe('completed');
  });
});
