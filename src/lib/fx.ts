import type { Transaction, DerivedHolding } from '@/types/portfolio';
import { calculateXIRR } from '@/lib/xirr';

export interface FxRate {
  date: string; // YYYY-MM-DD
  rate: number; // INR per 1 USD
  source: string;
}

export interface RateLookup {
  rate: number;
  source: string;
  effectiveDate: string;
  exact: boolean;
}

export function toISODate(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/**
 * Nearest prior rate for a date (weekend/holiday safe).
 * If the requested date is older than every stored rate, falls back to the
 * oldest available rate and flags it as inexact so the UI can disclose it.
 */
export function rateOn(sorted: FxRate[], date: string | Date): RateLookup | null {
  if (sorted.length === 0) return null;
  const target = toISODate(date);
  let found: FxRate | null = null;
  for (const r of sorted) {
    if (r.date <= target) found = r;
    else break;
  }
  if (found) {
    return { rate: found.rate, source: found.source, effectiveDate: found.date, exact: found.date === target };
  }
  const first = sorted[0];
  return { rate: first.rate, source: first.source, effectiveDate: first.date, exact: false };
}

export function latestRate(sorted: FxRate[]): FxRate | null {
  return sorted.length ? sorted[sorted.length - 1] : null;
}

export interface UsdCashflow {
  date: Date;
  inr: number; // signed: negative = outflow (BUY)
  usd: number;
  rate: number;
  effectiveDate: string;
  source: string;
  exact: boolean;
}

export function buildUsdCashflows(transactions: Transaction[], sorted: FxRate[]): UsdCashflow[] {
  const out: UsdCashflow[] = [];
  for (const t of transactions) {
    const look = rateOn(sorted, t.date);
    if (!look) continue;
    const inr = t.type === 'BUY' ? -(t.quantity * t.price) : t.quantity * t.price;
    out.push({
      date: new Date(t.date),
      inr,
      usd: inr / look.rate,
      rate: look.rate,
      effectiveDate: look.effectiveDate,
      source: look.source,
      exact: look.exact,
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function usdXirr(flows: UsdCashflow[], terminalUsd: number): number | null {
  if (flows.length === 0) return null;
  const cf = flows.map((f) => ({ amount: f.usd, date: f.date }));
  if (terminalUsd > 0) cf.push({ amount: terminalUsd, date: new Date() });
  return calculateXIRR(cf);
}

export interface HoldingUsdRow {
  symbol: string;
  investedInr: number;
  currentInr: number;
  inrReturnPct: number;
  investedUsd: number;
  currentUsd: number;
  usdReturnPct: number;
  currencyImpactPct: number;
  avgBuyRate: number;
  approximated: boolean;
}

/**
 * Per-holding USD view. Cost basis is converted at each buy's trade-date rate;
 * current value at the latest rate.
 */
export function holdingsInUsd(
  holdings: DerivedHolding[],
  sorted: FxRate[],
  spot: number
): HoldingUsdRow[] {
  return holdings.map((h) => {
    let investedUsd = 0;
    let netQty = 0;
    let costInr = 0;
    let approximated = false;

    for (const t of [...h.transactions].sort((a, b) => +new Date(a.date) - +new Date(b.date))) {
      const look = rateOn(sorted, t.date);
      const rate = look?.rate ?? spot;
      if (!look || !look.exact) approximated = true;
      const amt = t.quantity * t.price;
      if (t.type === 'BUY') {
        investedUsd += amt / rate;
        costInr += amt;
        netQty += t.quantity;
      } else {
        // Reduce cost basis proportionally (average-cost) in both currencies
        const portion = netQty > 0 ? Math.min(t.quantity / netQty, 1) : 0;
        investedUsd -= investedUsd * portion;
        costInr -= costInr * portion;
        netQty -= t.quantity;
      }
    }

    const currentUsd = spot > 0 ? h.currentValue / spot : 0;
    const inrReturnPct = h.totalInvested !== 0 ? (h.pnl / h.totalInvested) * 100 : 0;
    const usdReturnPct = investedUsd !== 0 ? ((currentUsd - investedUsd) / investedUsd) * 100 : 0;
    const avgBuyRate = investedUsd !== 0 ? costInr / investedUsd : spot;

    return {
      symbol: h.symbol,
      investedInr: h.totalInvested,
      currentInr: h.currentValue,
      inrReturnPct,
      investedUsd,
      currentUsd,
      usdReturnPct,
      currencyImpactPct: usdReturnPct - inrReturnPct,
      avgBuyRate,
      approximated,
    };
  });
}

export interface Attribution {
  assetReturnPct: number;   // INR-denominated asset performance
  currencyEffectPct: number; // multiplicative FX contribution
  totalUsdReturnPct: number;
  avgEntryRate: number;
  spotRate: number;
}

/**
 * Decompose USD return: (1 + rUsd) = (1 + rInr) * (entryRate / spotRate)
 * currencyEffect = (1 + rInr) * (entryRate/spot - 1)
 */
export function attribution(
  investedInr: number,
  currentInr: number,
  investedUsd: number,
  currentUsd: number,
  spot: number
): Attribution {
  const rInr = investedInr !== 0 ? currentInr / investedInr - 1 : 0;
  const rUsd = investedUsd !== 0 ? currentUsd / investedUsd - 1 : 0;
  const avgEntryRate = investedUsd !== 0 ? investedInr / investedUsd : spot;
  const fxFactor = spot !== 0 ? avgEntryRate / spot : 1;
  const currencyEffect = (1 + rInr) * (fxFactor - 1);
  return {
    assetReturnPct: rInr * 100,
    currencyEffectPct: currencyEffect * 100,
    totalUsdReturnPct: rUsd * 100,
    avgEntryRate,
    spotRate: spot,
  };
}

export function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtInr(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}
