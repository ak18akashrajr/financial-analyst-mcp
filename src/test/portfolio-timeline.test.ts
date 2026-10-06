// buildPortfolioTimeline (src/lib/portfolioTimeline.ts) feeds PortfolioCharts' "Principal Capital Allocated
// vs Current Value" and P&L-over-time charts. Its cost basis must be FIFO like the rest of the app (audit
// M7); it used to subtract a sale's PROCEEDS from "invested", the exact bug src/lib/costBasis.ts documents.
import { describe, expect, it } from 'vitest';
import { buildPortfolioTimeline } from '@/lib/portfolioTimeline';
import type { Transaction } from '@/types/portfolio';

const fmt = (iso: string) => `label:${iso}`;
const build = (txns: Transaction[], prices: Record<string, number>, today = '2026-12-31') =>
  buildPortfolioTimeline(txns, prices, today, fmt);

function txn(type: 'BUY' | 'SELL', quantity: number, price: number, date: string, symbol = 'ACME'): Transaction {
  return { id: `${symbol}-${type}-${date}-${quantity}`, symbol, type, quantity, price, date };
}

describe('buildPortfolioTimeline — FIFO invested (audit M7)', () => {
  it('does not let a profitable partial sell drive invested negative (the audit example)', () => {
    // Buy 10 @ 100, sell 9 @ 500: one share left, still costed at ₹100. The old formula gave
    // 1000 − 9×500 = −₹3,500.
    const points = build([txn('BUY', 10, 100, '2026-01-01'), txn('SELL', 9, 500, '2026-02-01')], { ACME: 500 });

    const afterSell = points.find((p) => p.date === '2026-02-01')!;
    expect(afterSell.invested).toBe(100);
    expect(afterSell.currentValue).toBe(500); // 1 share x ₹500
    expect(afterSell.pnl).toBe(400);
  });

  it('consumes the oldest lot first across lots bought at different prices', () => {
    // 10 @ 100, 10 @ 200, sell 10 -> the ₹100 lot goes, leaving 10 @ ₹200 = ₹2,000 (old formula: 3000 − 10×sell).
    const points = build(
      [txn('BUY', 10, 100, '2026-01-01'), txn('BUY', 10, 200, '2026-02-01'), txn('SELL', 10, 250, '2026-03-01')],
      { ACME: 200 },
    );
    const afterSell = points.find((p) => p.date === '2026-03-01')!;
    expect(afterSell.invested).toBe(2000);
    expect(afterSell.pnl).toBe(0); // 10 x ₹200 current vs ₹2,000 cost
  });

  it('tracks each symbol independently', () => {
    const points = build(
      [
        txn('BUY', 10, 100, '2026-01-01', 'AAA'),
        txn('BUY', 5, 400, '2026-01-01', 'BBB'),
        txn('SELL', 5, 150, '2026-02-01', 'AAA'),
      ],
      { AAA: 150, BBB: 400 },
    );
    const last = points.find((p) => p.date === '2026-02-01')!;
    expect(last.invested).toBe(5 * 100 + 5 * 400); // AAA: 5 left @ 100; BBB untouched
    expect(last.currentValue).toBe(5 * 150 + 5 * 400);
  });

  it('drops a fully-exited symbol from both invested and current value', () => {
    const points = build([txn('BUY', 10, 100, '2026-01-01'), txn('SELL', 10, 130, '2026-02-01')], { ACME: 130 });
    const afterExit = points.find((p) => p.date === '2026-02-01')!;
    expect(afterExit.invested).toBe(0);
    expect(afterExit.currentValue).toBe(0);
  });

  it('treats an oversell as depleting every open lot rather than going negative', () => {
    const points = build([txn('BUY', 10, 100, '2026-01-01'), txn('SELL', 15, 120, '2026-02-01')], { ACME: 120 });
    const afterSell = points.find((p) => p.date === '2026-02-01')!;
    expect(afterSell.invested).toBe(0);
    expect(afterSell.currentValue).toBe(0);
  });
});

describe('buildPortfolioTimeline — behaviour that must not change', () => {
  it('returns an empty series for no transactions', () => {
    expect(build([], {})).toEqual([]);
  });

  it('keeps invested equal to the sum of buys when there are no sells', () => {
    const points = build([txn('BUY', 10, 100, '2026-01-01'), txn('BUY', 5, 120, '2026-02-01')], { ACME: 130 }, '2026-02-01');
    expect(points.map((p) => p.invested)).toEqual([1000, 1600]);
    expect(points.map((p) => p.currentValue)).toEqual([1300, 1950]);
  });

  it('groups a same-day buy and sell into one point', () => {
    const points = build(
      [txn('BUY', 10, 100, '2026-01-01T09:00:00Z'), txn('SELL', 4, 110, '2026-01-01T15:00:00Z')],
      { ACME: 110 },
      '2026-01-01',
    );
    expect(points).toHaveLength(1);
    expect(points[0].invested).toBe(600); // 6 shares left @ ₹100
  });

  it('appends a closing point at today only when the last transaction day is not today', () => {
    const txns = [txn('BUY', 10, 100, '2026-01-01')];
    const before = build(txns, { ACME: 150 }, '2026-06-01');
    expect(before.map((p) => p.date)).toEqual(['2026-01-01', '2026-06-01']);
    expect(before[1]).toMatchObject({ invested: 1000, currentValue: 1500, pnl: 500, dateLabel: 'label:2026-06-01' });

    const same = build(txns, { ACME: 150 }, '2026-01-01');
    expect(same.map((p) => p.date)).toEqual(['2026-01-01']);
  });

  it('falls back to the last trade price when a symbol has no current price', () => {
    const points = build([txn('BUY', 10, 100, '2026-01-01'), txn('BUY', 10, 120, '2026-02-01')], {});
    expect(points[0].currentValue).toBe(1000); // 10 x last trade price ₹100
    expect(points[1].currentValue).toBe(2400); // 20 x last trade price ₹120
  });

  it('keys points off the transaction date with its time stripped, ascending', () => {
    const points = build(
      [txn('BUY', 1, 100, '2026-03-05T10:00:00Z'), txn('BUY', 1, 100, '2026-01-02T10:00:00Z')],
      { ACME: 100 },
      '2026-03-05',
    );
    expect(points.map((p) => p.date)).toEqual(['2026-01-02', '2026-03-05']);
  });
});
