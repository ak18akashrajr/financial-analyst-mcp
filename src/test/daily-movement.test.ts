import { describe, expect, it } from 'vitest';
import {
  buildDailyMovements,
  classifyDay,
  fyMonthIdx,
  fyOf,
  lastWeekdayOfMonth,
  summarizeFy,
  summarizeMonths,
} from '@/lib/dailyMovement';

const buy = (symbol: string, quantity: number, price: number, date: string) => ({ symbol, type: 'BUY' as const, quantity, price, date });
const sell = (symbol: string, quantity: number, price: number, date: string) => ({ symbol, type: 'SELL' as const, quantity, price, date });
const bars = (...pairs: [string, number][]) => pairs.map(([date, close]) => ({ date, close }));

describe('classifyDay', () => {
  it('uses a ±0.05% neutral band, boundaries inclusive of grey', () => {
    expect(classifyDay(0.06)).toBe('green');
    expect(classifyDay(0.05)).toBe('grey');
    expect(classifyDay(0)).toBe('grey');
    expect(classifyDay(-0.05)).toBe('grey');
    expect(classifyDay(-0.06)).toBe('red');
  });
});

describe('buildDailyMovements', () => {
  // 2026-11-02 is a Monday.
  const prices = {
    AAA: bars(['2026-11-02', 100], ['2026-11-03', 110], ['2026-11-04', 99], ['2026-11-05', 99.01]),
  };

  it('computes day-over-day moves with exact per-symbol detail; first day is only a baseline', () => {
    const { days } = buildDailyMovements([buy('AAA', 10, 100, '2026-11-02')], prices);
    expect(days.map((d) => d.date)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    const d1 = days[0];
    expect(d1.prevDate).toBe('2026-11-02');
    expect(d1.pnl).toBeCloseTo(100); // 10 × (110 − 100)
    expect(d1.pct).toBeCloseTo(10);
    expect(d1.cls).toBe('green');
    expect(d1.moves).toHaveLength(1);
    expect(d1.moves[0]).toMatchObject({ symbol: 'AAA', closePrev: 100, close: 110, qtyPrev: 10, qtyNow: 10 });
    expect(days[1].cls).toBe('red');
    expect(days[1].pnl).toBeCloseTo(-110);
    // 0.01 / 99 = ~0.0101% → inside the band
    expect(days[2].cls).toBe('grey');
  });

  it('does not read a buy as a gain: flow is removed and per-symbol pnl sums to the day pnl', () => {
    const txns = [buy('AAA', 10, 100, '2026-11-02'), buy('AAA', 10, 110, '2026-11-03')];
    const { days } = buildDailyMovements(txns, prices);
    const d = days[0]; // 3 Nov: buy 10 more at 110 on the day
    expect(d.netFlow).toBeCloseTo(1100);
    expect(d.value).toBeCloseTo(2200);
    // Only the 10 shares held overnight moved: +10 each.
    expect(d.pnl).toBeCloseTo(100);
    expect(d.moves[0].pnl).toBeCloseTo(100);
    expect(d.moves.reduce((s, m) => s + m.pnl, 0)).toBeCloseTo(d.pnl);
  });

  it('attributes a sell correctly (value falls but the move is not a loss)', () => {
    const txns = [buy('AAA', 10, 100, '2026-11-02'), sell('AAA', 5, 110, '2026-11-03')];
    const { days } = buildDailyMovements(txns, prices);
    expect(days[0].netFlow).toBeCloseTo(-550);
    expect(days[0].pnl).toBeCloseTo(100);
  });

  it('drops weekend-dated bars (e.g. month-start monthly bars) from the trading-day grid', () => {
    const p = { AAA: bars(['2026-11-06', 100], ['2026-11-07', 500], ['2026-11-09', 101]) }; // 7 Nov = Saturday
    const { days } = buildDailyMovements([buy('AAA', 1, 100, '2026-11-06')], p);
    expect(days.map((d) => d.date)).toEqual(['2026-11-09']);
    expect(days[0].pct).toBeCloseTo(1);
  });

  it('does not bridge a gap longer than 5 calendar days', () => {
    const p = { AAA: bars(['2026-11-02', 100], ['2026-11-12', 120]) };
    expect(buildDailyMovements([buy('AAA', 1, 100, '2026-11-02')], p).days).toEqual([]);
  });

  it('skips days where a held symbol has no price yet, and reports it', () => {
    const p = { AAA: bars(['2026-11-02', 100], ['2026-11-03', 101], ['2026-11-04', 102]), BBB: bars(['2026-11-04', 50], ['2026-11-05', 55]) };
    const txns = [buy('AAA', 1, 100, '2026-11-02'), buy('BBB', 1, 50, '2026-11-02')];
    const r = buildDailyMovements(txns, p);
    expect(r.symbolsWithoutPrices).toEqual(['BBB']);
    // 3 & 4 Nov: BBB unpriced at the previous / current end of the pair → only 5 Nov... 4 Nov is the first complete point, so 5 Nov is the only move.
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-05']);
  });

  it('returns nothing without transactions', () => {
    expect(buildDailyMovements([], prices).days).toEqual([]);
  });
});

describe('FY / month helpers', () => {
  it('maps dates to Indian FY and Apr-first month index', () => {
    expect(fyOf('2026-04-01')).toBe(2026);
    expect(fyOf('2027-03-31')).toBe(2026);
    expect(fyMonthIdx('2026-04-15')).toBe(0);
    expect(fyMonthIdx('2027-03-02')).toBe(11);
    expect(fyMonthIdx('2026-12-31')).toBe(8);
  });

  it('finds the last weekday of a month', () => {
    expect(lastWeekdayOfMonth(2026, 10)).toBe('2026-10-30'); // 31 Oct 2026 is a Saturday
    expect(lastWeekdayOfMonth(2026, 11)).toBe('2026-11-30'); // Monday
    expect(lastWeekdayOfMonth(2026, 5)).toBe('2026-05-29'); // 31 May 2026 is a Sunday
  });
});

describe('summarizeMonths', () => {
  const mk = (date: string, cls: 'green' | 'red' | 'grey', pnl: number) =>
    ({ date, prevDate: date, prevValue: 1, value: 1, netFlow: 0, pnl, pct: 0, cls, moves: [] });

  it('counts green/red/grey per FY-month and only marks a month final after its last weekday', () => {
    const days = [mk('2026-10-28', 'green', 5), mk('2026-10-29', 'red', -2), mk('2026-10-30', 'grey', 0), mk('2026-11-02', 'green', 1)];
    const m = summarizeMonths(days, '2026-11-02');
    const oct = m.get('2026-6')!;
    expect(oct).toMatchObject({ green: 1, red: 1, grey: 1, active: 3, final: true });
    expect(oct.pnl).toBe(3);
    expect(m.get('2026-7')).toMatchObject({ green: 1, active: 1, final: false });
  });

  it('is not final on the last weekday itself (that day has not closed yet)', () => {
    const m = summarizeMonths([mk('2026-10-29', 'green', 1)], '2026-10-30');
    expect(m.get('2026-6')!.final).toBe(false);
    expect(summarizeMonths([mk('2026-10-29', 'green', 1)], '2026-10-31').get('2026-6')!.final).toBe(true);
  });
});

describe('summarizeFy', () => {
  const mk = (date: string, cls: 'green' | 'red' | 'grey', pnl: number) =>
    ({ date, prevDate: date, prevValue: 1, value: 1, netFlow: 0, pnl, pct: 0, cls, moves: [] });

  it('rate = green ÷ all active days (grey stays in the total); only that FY is counted', () => {
    const days = [mk('2026-04-01', 'green', 10), mk('2026-05-04', 'red', -4), mk('2026-06-01', 'grey', 0), mk('2026-07-01', 'green', 1), mk('2027-01-04', 'red', -2), mk('2026-03-31', 'green', 99)];
    const s = summarizeFy(days, 2026, '2026-11-04');
    expect(s).toMatchObject({ green: 2, red: 2, grey: 1, active: 5, final: false });
    expect(s.profitRatePct).toBeCloseTo(40);
    expect(s.pnl).toBeCloseTo(5);
  });

  it('is final only after the last weekday of March, and a FY with no days has rate 0', () => {
    expect(summarizeFy([], 2025, '2026-04-01').final).toBe(true); // 31 Mar 2026 is a Tuesday
    expect(summarizeFy([], 2025, '2026-03-31').final).toBe(false);
    expect(summarizeFy([], 2026, '2026-11-04').profitRatePct).toBe(0);
  });
});
