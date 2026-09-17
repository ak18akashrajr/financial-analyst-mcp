import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { mergeNetWorthHistories, type NetWorthHistoryRow } from '@/lib/mergeNetWorthHistories';
import { logClientError } from '@/lib/clientErrorLogging';

// Raw DB row shape (snake_case) — kept identical to what every net_worth_history consumer
// (NetWorthChart, DebtChart, Benchmark, DollarAdjustedReturns, Reports, SeasonalityHeatmap)
// already expects from a direct `.select('*')`, so switching them to this hook needs no change
// to their own row-mapping code.
export interface NetWorthHistoryDbRow {
  recorded_at: string;
  net_worth: number;
  portfolio_value: number;
  liquid_cash: number;
  vault_cash: number;
  pf_balance: number;
  credit_card_debt: number;
}

function toDbRow(r: NetWorthHistoryRow): NetWorthHistoryDbRow {
  return {
    recorded_at: r.recordedAt,
    net_worth: r.netWorth,
    portfolio_value: r.portfolioValue,
    liquid_cash: r.liquidCash,
    vault_cash: r.vaultCash,
    pf_balance: r.pfBalance,
    credit_card_debt: r.creditCardDebt,
  };
}

/**
 * Single source of net_worth_history data, family-member-aware: a specific member's own rows,
 * or (for 'all') every member's rows rolled up into one combined series via
 * mergeNetWorthHistories. Always ascending by recorded_at, matching every existing consumer's
 * own `.order('recorded_at', { ascending: true })`.
 */
export function useNetWorthHistory(refreshKey: number = 0) {
  const { activeMemberId } = useFamilyMemberSelection();
  const [data, setData] = useState<NetWorthHistoryDbRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: rows, error } = await supabase
        .from('net_worth_history')
        .select('recorded_at, net_worth, portfolio_value, liquid_cash, vault_cash, pf_balance, credit_card_debt, family_member_id')
        .order('recorded_at', { ascending: true });

      if (cancelled) return;
      if (error) {
        logClientError('useNetWorthHistory', 'Failed to load net_worth_history', { error });
        setLoading(false);
        return;
      }

      const parsed: NetWorthHistoryRow[] = (rows ?? []).map((r: any) => ({
        familyMemberId: r.family_member_id,
        recordedAt: r.recorded_at,
        netWorth: Number(r.net_worth),
        portfolioValue: Number(r.portfolio_value),
        liquidCash: Number(r.liquid_cash),
        vaultCash: Number(r.vault_cash),
        pfBalance: Number(r.pf_balance),
        creditCardDebt: Number(r.credit_card_debt),
      }));

      const scoped =
        activeMemberId === 'all'
          ? mergeNetWorthHistories(parsed)
          : parsed.filter((r) => r.familyMemberId === activeMemberId);

      setData(scoped.map(toDbRow));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMemberId, refreshKey]);

  return { data, loading };
}
