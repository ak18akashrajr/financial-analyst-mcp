import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeFamilyNetWorthSplit, type MemberPortfolioSplit } from '@/lib/familyPortfolioSplit';
import { logClientError } from '@/lib/clientErrorLogging';
import type { DerivedHolding } from '@/types/portfolio';

/**
 * Per-member net worth breakdown for the combined "All Family" view. `holdings` is passed in from
 * an existing usePortfolio() call (already fetched, member-tagged transactions and all) rather
 * than refetched here — this hook only adds the one extra query usePortfolio's 'all' mode doesn't
 * already expose in per-member form: raw cash_settings rows. `enabled` should be
 * `activeMemberId === 'all'`; when false this never queries and returns an empty split.
 */
export function useFamilyNetWorthSplit(holdings: DerivedHolding[], enabled: boolean) {
  const [splits, setSplits] = useState<MemberPortfolioSplit[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setSplits([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('cash_settings')
        .select('family_member_id, liquid_cash, vault_cash, pf_balance, credit_card_debt');

      if (cancelled) return;
      if (error) {
        logClientError('useFamilyNetWorthSplit', 'Failed to load cash_settings', { error });
        setLoading(false);
        return;
      }

      const cashRows = (data ?? []).map((r: any) => ({
        familyMemberId: r.family_member_id,
        liquidCash: Number(r.liquid_cash ?? 0),
        vaultCash: Number(r.vault_cash ?? 0),
        pfBalance: Number(r.pf_balance ?? 0),
        creditCardDebt: Number(r.credit_card_debt ?? 0),
      }));

      setSplits(computeFamilyNetWorthSplit(holdings, cashRows));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [holdings, enabled]);

  return { splits, loading };
}
