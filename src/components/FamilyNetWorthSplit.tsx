import { Users2 } from 'lucide-react';
import type { MemberPortfolioSplit } from '@/lib/familyPortfolioSplit';
import type { FamilyMember } from '@/types/portfolio';
import { getMemberDisplayName } from '@/lib/familyMemberDisplay';

import { Card } from '@/components/ui/card';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  splits: MemberPortfolioSplit[];
  members: FamilyMember[];
  hidden: boolean;
}

// Only rendered by the caller when activeMemberId === 'all' and there's more than one member to
// actually split across — see Index.tsx. Splits the combined household net worth back out by
// member (live, from each member's own holdings share + cash_settings row — see
// src/lib/familyPortfolioSplit.ts), so "All Family" isn't just one blended total.
export function FamilyNetWorthSplit({ splits, members, hidden }: Props) {
  if (splits.length < 2) return null;

  const total = splits.reduce((s, m) => s + m.netWorth, 0);

  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-lg bg-foreground/5 text-foreground flex items-center justify-center">
          <Users2 className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground tracking-tight">Family Net Worth Split</p>
          <p className="text-[11px] text-muted-foreground">Each member's live share of the combined total</p>
        </div>
      </div>

      <div className="space-y-3">
        {splits.map((s) => {
          const name = getMemberDisplayName(members.find((m) => m.id === s.familyMemberId));
          // A member with negative net worth (debt exceeding assets) or a total <= 0 has no
          // meaningful bar-fill percentage — show the amount without a misleading bar width.
          const pct = total > 0 ? Math.max(0, (s.netWorth / total) * 100) : 0;
          return (
            <div key={s.familyMemberId}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm text-foreground">{name}</span>
                <span className="text-xs text-muted-foreground">
                  {hidden ? '•••' : fmt(s.netWorth)} <span className="text-foreground font-medium">({pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
