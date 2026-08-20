import type { DerivedHolding } from '@/types/portfolio';

export interface PerformanceContribution {
  symbol: string;
  pnl: number;
  /** This holding's P&L as a % of *total* invested capital across all current
   * holdings — these sum to PortfolioSummary.totalPnlPercent (up to rounding),
   * so it decomposes the portfolio's overall return, unlike `pnlPercent` below
   * (the holding's return relative to its *own* cost basis — the number
   * TopMovers already ranks by, which doesn't add up to anything portfolio-wide). */
  contributionPercent: number;
  pnlPercent: number;
  currentValue: number;
}

/**
 * Decomposes total portfolio return into per-holding contribution — "which
 * holdings drove my overall % return," not just "which holdings personally
 * did best."
 *
 * Scope: current holdings only (`holdings` is expected pre-filtered to
 * totalQuantity > 0, same as usePortfolio.ts's `holdings` and `topMovers`).
 * Fully-exited positions' realized P&L isn't included — scoped out
 * deliberately, see docs/feature-ideas.md item #9.
 */
export function computePerformanceAttribution(holdings: DerivedHolding[]): PerformanceContribution[] {
  const totalInvested = holdings.reduce((s, h) => s + h.totalInvested, 0);
  if (totalInvested <= 0) return [];

  return holdings
    .map((h) => ({
      symbol: h.symbol,
      pnl: h.pnl,
      contributionPercent: (h.pnl / totalInvested) * 100,
      pnlPercent: h.pnlPercent,
      currentValue: h.currentValue,
    }))
    .sort((a, b) => b.contributionPercent - a.contributionPercent);
}
