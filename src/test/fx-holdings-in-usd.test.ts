// holdingsInUsd (src/lib/fx.ts) must cost USD basis with the same FIFO lots as the INR side (audit M4).
// It used to reduce both bases by average cost on a sell while h.totalInvested (INR) is FIFO, so after a
// partial sell across different buy prices the two currencies described different shares and a fake
// "currency effect" appeared even with a flat exchange rate.
import { describe, expect, it } from 'vitest';
import { holdingsInUsd, type FxRate } from '@/lib/fx';
import { computeFifoPosition } from '@/lib/costBasis';
import type { DerivedHolding, Transaction } from '@/types/portfolio';

const rates = (entries: Array<[string, number]>): FxRate[] =>
  entries.map(([date, rate]) => ({ date, rate, source: 'test' }));

function txn(type: 'BUY' | 'SELL', quantity: number, price: number, date: string): Transaction {
  return { id: `${type}-${date}-${quantity}`, symbol: 'AAPL', type, quantity, price, date };
}

/** A holding whose INR figures come from the real FIFO function, exactly as usePortfolio builds them. */
function holdingFrom(transactions: Transaction[], currentPrice: number): DerivedHolding {
  const { totalQuantity, totalInvested } = computeFifoPosition(transactions);
  const currentValue = currentPrice * totalQuantity;
  return {
    symbol: 'AAPL',
    totalQuantity,
    totalInvested,
    currentValue,
    pnl: currentValue - totalInvested,
    transactions,
  } as unknown as DerivedHolding;
}

describe('holdingsInUsd — FIFO USD cost basis (audit M4)', () => {
  it('shows no currency effect after a partial sell across different buy prices when FX is flat', () => {
    // The audit's example: buy 10 @ 100 + 10 @ 200, sell 10, price 200, FX flat at 80.
    const txns = [
      txn('BUY', 10, 100, '2026-01-01'),
      txn('BUY', 10, 200, '2026-02-01'),
      txn('SELL', 10, 200, '2026-03-01'),
    ];
    const flat = rates([['2026-01-01', 80], ['2026-02-01', 80], ['2026-03-01', 80]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 200)], flat, 80);

    expect(row.investedInr).toBe(2000); // FIFO: the ₹100 lot is gone, 10 @ ₹200 remain
    expect(row.investedUsd).toBeCloseTo(25, 6); // 2000 / 80 (was 18.75 under average cost)
    expect(row.inrReturnPct).toBeCloseTo(0, 6);
    expect(row.usdReturnPct).toBeCloseTo(0, 6); // was +33.3%
    expect(row.currencyImpactPct).toBeCloseTo(0, 6); // was +33.3%
    expect(row.avgBuyRate).toBeCloseTo(80, 6); // was ~106.67 under the old formula
  });

  it("keeps each surviving lot at its own trade-date rate, not an average across sold lots", () => {
    // Lot 1: 10 @ 100 bought at ₹70/$; lot 2: 10 @ 200 bought at ₹90/$. Selling 10 removes lot 1 (FIFO),
    // so the remaining cost is lot 2 alone: $2000/90, entry rate exactly 90.
    const txns = [
      txn('BUY', 10, 100, '2026-01-01'),
      txn('BUY', 10, 200, '2026-02-01'),
      txn('SELL', 10, 250, '2026-03-01'),
    ];
    const fx = rates([['2026-01-01', 70], ['2026-02-01', 90], ['2026-03-01', 90]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 250)], fx, 90);

    expect(row.investedUsd).toBeCloseTo(2000 / 90, 6);
    expect(row.avgBuyRate).toBeCloseTo(90, 6);
    // Same ₹ price move, same rate -> no currency effect, and the USD return equals the INR return (25%).
    expect(row.inrReturnPct).toBeCloseTo(25, 6);
    expect(row.usdReturnPct).toBeCloseTo(25, 6);
  });

  it('splits a lot correctly when a sell only partly consumes it', () => {
    // 10 @ 100 at ₹80, sell 4 -> 6 shares remain from that lot, still at ₹80.
    const txns = [txn('BUY', 10, 100, '2026-01-01'), txn('SELL', 4, 150, '2026-02-01')];
    const fx = rates([['2026-01-01', 80], ['2026-02-01', 85]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 150)], fx, 85);

    expect(row.investedInr).toBe(600);
    expect(row.investedUsd).toBeCloseTo(600 / 80, 6);
    expect(row.avgBuyRate).toBeCloseTo(80, 6);
  });

  it('reports a genuine currency effect when the rate really moved', () => {
    const txns = [txn('BUY', 10, 100, '2026-01-01')];
    const fx = rates([['2026-01-01', 80], ['2026-06-01', 88]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 100)], fx, 88);

    // INR price flat (0%), rupee weakened 80 -> 88, so in USD the position lost 9.09%.
    expect(row.inrReturnPct).toBeCloseTo(0, 6);
    expect(row.usdReturnPct).toBeCloseTo((80 / 88 - 1) * 100, 6);
    expect(row.currencyImpactPct).toBeCloseTo((80 / 88 - 1) * 100, 6);
  });

  it('leaves a holding with no sells unchanged', () => {
    const txns = [txn('BUY', 5, 100, '2026-01-01'), txn('BUY', 5, 120, '2026-02-01')];
    const fx = rates([['2026-01-01', 80], ['2026-02-01', 82]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 130)], fx, 82);

    expect(row.investedUsd).toBeCloseTo(500 / 80 + 600 / 82, 6);
  });

  it("agrees with the app's FIFO function on the INR cost for a messy sequence", () => {
    // Interleaved buys/sells, an oversell and a rebuy: the lots behind investedUsd must be exactly the
    // lots behind h.totalInvested, or the two currencies are describing different shares again.
    const txns = [
      txn('BUY', 10, 100, '2026-01-01'),
      txn('BUY', 5, 130, '2026-01-15'),
      txn('SELL', 12, 140, '2026-02-01'),
      txn('BUY', 8, 150, '2026-02-10'),
      txn('SELL', 4, 160, '2026-03-01'),
      txn('BUY', 3, 170, '2026-03-20'),
    ];
    const fx = rates([['2026-01-01', 80], ['2026-01-15', 81], ['2026-02-01', 82], ['2026-02-10', 83], ['2026-03-01', 84], ['2026-03-20', 85]]);
    const h = holdingFrom(txns, 180);
    const [row] = holdingsInUsd([h], fx, 85);

    expect(row.investedInr).toBeCloseTo(h.totalInvested, 6);
    // costInr is only exposed through avgBuyRate (= costInr / investedUsd), so recover it.
    expect(row.avgBuyRate * row.investedUsd).toBeCloseTo(h.totalInvested, 6);
  });

  it('drops a fully-exited holding to zero cost rather than a stale remainder', () => {
    const txns = [txn('BUY', 10, 100, '2026-01-01'), txn('SELL', 10, 120, '2026-02-01')];
    const fx = rates([['2026-01-01', 80], ['2026-02-01', 80]]);
    const [row] = holdingsInUsd([holdingFrom(txns, 120)], fx, 80);

    expect(row.investedUsd).toBe(0);
    expect(row.usdReturnPct).toBe(0);
  });
});
