import { getMemberUnitShares } from '@/lib/lotAttribution';
import type { DerivedHolding } from '@/types/portfolio';

export interface MemberCashRow {
  familyMemberId: string;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
}

export interface MemberPortfolioSplit {
  familyMemberId: string;
  holdingsValue: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
  netWorth: number;
}

// Splits the combined "All Family" totals back out by member, for a live net-worth breakdown card
// (only meaningful in that combined view — an individual member's own view has nothing to split).
// `holdings` is the SAME array usePortfolio() already returns for 'all' — each holding's
// transactions are tagged with family_member_id, so getMemberUnitShares (the same FIFO
// lot-attribution GoalTrack.tsx's per-member Goals contribution uses) tells us whose units they
// are; multiplied by the live currentPrice, that's each member's live share of that holding's
// market value. Cash isn't attributable the same way (no lot history), so it's summed directly
// from each member's own cash_settings row instead.
export function computeFamilyNetWorthSplit(
  holdings: DerivedHolding[],
  cashRows: MemberCashRow[],
): MemberPortfolioSplit[] {
  const byMember = new Map<string, MemberPortfolioSplit>();
  const ensure = (familyMemberId: string): MemberPortfolioSplit => {
    let entry = byMember.get(familyMemberId);
    if (!entry) {
      entry = { familyMemberId, holdingsValue: 0, liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0, netWorth: 0 };
      byMember.set(familyMemberId, entry);
    }
    return entry;
  };

  for (const h of holdings) {
    if (h.totalQuantity <= 0 || h.currentPrice <= 0) continue;
    const shares = getMemberUnitShares(h);
    for (const [familyMemberId, qty] of Object.entries(shares)) {
      ensure(familyMemberId).holdingsValue += qty * h.currentPrice;
    }
  }

  for (const c of cashRows) {
    const entry = ensure(c.familyMemberId);
    entry.liquidCash += c.liquidCash;
    entry.vaultCash += c.vaultCash;
    entry.pfBalance += c.pfBalance;
    entry.creditCardDebt += c.creditCardDebt;
  }

  for (const entry of byMember.values()) {
    entry.netWorth = entry.holdingsValue + entry.liquidCash + entry.vaultCash + entry.pfBalance - entry.creditCardDebt;
  }

  return [...byMember.values()].sort((a, b) => b.netWorth - a.netWorth);
}
