/**
 * "What if this same money had gone into the index instead?" XIRR.
 *
 * Replays each real transaction as a buy/sell of benchmark index units on the exact same date,
 * for the exact same ₹ amount — running an index-unit ledger alongside — then values the
 * remaining units at the latest available benchmark close as the terminal cash flow. XIRR is
 * then solved on that synthetic cash-flow series, using the same `calculateXIRR` engine as the
 * real portfolio XIRR — so the two numbers are directly comparable (same dates, same amounts,
 * same solver; only the underlying asset differs).
 *
 * This mirrors the standard "invested-in-the-index-instead" benchmark comparison used by
 * portfolio trackers (Kuvera, Zerodha Console, etc.) — not a naive index CAGR over the holding
 * period, which would ignore the timing/sizing of contributions.
 *
 * See docs/xirr-breakdown.md for the full rationale, including why the manual PF balance is
 * excluded (no dated contribution history exists to replay).
 */
import { calculateXIRR, type CashFlow } from './xirr';
import type { Transaction } from '@/types/portfolio';

export interface BenchmarkPricePoint {
  date: string; // 'YYYY-MM-DD'
  close: number;
}

export interface BenchmarkXirrResult {
  xirr: number | null;
  /** Transactions that fell before the earliest available benchmark price and were excluded. */
  excludedCount: number;
  totalCount: number;
  earliestAvailableDate: string | null;
  earliestNeededDate: string | null;
}

/** Latest price at or before `date`. `sortedPrices` must be ascending by date. */
function priceOnOrBefore(sortedPrices: BenchmarkPricePoint[], date: Date): number | null {
  let result: number | null = null;
  for (const p of sortedPrices) {
    if (new Date(p.date).getTime() <= date.getTime()) result = p.close;
    else break;
  }
  return result;
}

export function computeBenchmarkXirr(
  transactions: Transaction[],
  prices: BenchmarkPricePoint[],
  asOf: Date = new Date(),
): BenchmarkXirrResult {
  const sortedTxns = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const earliestNeededDate = sortedTxns[0]?.date ?? null;

  if (sortedTxns.length === 0 || prices.length === 0) {
    return {
      xirr: null,
      excludedCount: sortedTxns.length,
      totalCount: sortedTxns.length,
      earliestAvailableDate: prices[0]?.date ?? null,
      earliestNeededDate,
    };
  }

  const sortedPrices = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const earliestAvailableDate = sortedPrices[0].date;

  const cashFlows: CashFlow[] = [];
  let units = 0;
  let excludedCount = 0;

  for (const t of sortedTxns) {
    const d = new Date(t.date);
    const price = priceOnOrBefore(sortedPrices, d);
    if (price == null || price <= 0) {
      excludedCount++;
      continue;
    }
    const amount = t.quantity * t.price;
    if (t.type === 'BUY') {
      units += amount / price;
      cashFlows.push({ amount: -amount, date: d });
    } else {
      units -= amount / price;
      cashFlows.push({ amount, date: d });
    }
  }

  // Mirrors usePortfolio's real XIRR: only add a terminal flow for a genuinely positive
  // remaining position. A hypothetical negative unit balance (real sells outpacing what the
  // same ₹ would have bought in the index by that point) is a known artifact of this replay
  // method — omit the terminal flow rather than feed calculateXIRR a nonsensical negative
  // "current value".
  const latestPrice = sortedPrices[sortedPrices.length - 1].close;
  if (units > 0) {
    cashFlows.push({ amount: units * latestPrice, date: asOf });
  }

  const xirr = calculateXIRR(cashFlows);

  return { xirr, excludedCount, totalCount: sortedTxns.length, earliestAvailableDate, earliestNeededDate };
}
