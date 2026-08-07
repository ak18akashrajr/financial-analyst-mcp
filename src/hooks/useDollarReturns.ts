import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import {
  attribution,
  buildUsdCashflows,
  holdingsInUsd,
  latestRate,
  rateOn,
  usdXirr,
  type FxRate,
} from '@/lib/fx';
import { toast } from 'sonner';

export function useDollarReturns() {
  const portfolio = usePortfolio();
  const { holdings, summary, transactions } = portfolio;

  const [rates, setRates] = useState<FxRate[]>([]);
  const [loadingFx, setLoadingFx] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastAttempts, setLastAttempts] = useState<Array<{ source: string; ok: boolean; note: string }>>([]);

  const loadRates = useCallback(async () => {
    const all: FxRate[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('fx_rates')
        .select('date, rate, source')
        .eq('pair', 'USDINR')
        .order('date', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('fx_rates load error', error.message);
        break;
      }
      const rows = (data ?? []).map((r) => ({
        date: r.date as string,
        rate: Number(r.rate),
        source: (r.source as string) ?? 'unknown',
      }));
      all.push(...rows);
      if (rows.length < pageSize) break;
    }
    setRates(all);
    setLoadingFx(false);
    return all;
  }, []);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const invoke = useCallback(
    async (mode: 'latest' | 'history', range?: string) => {
      const { data, error } = await supabase.functions.invoke('fetch-fx-rates', {
        body: { mode, range },
      });
      if (error) throw new Error(error.message);
      setLastAttempts(data?.attempts ?? []);
      return data as {
        rate: number | null;
        date: string | null;
        source: string | null;
        stale: boolean;
        inserted: number;
      };
    },
    []
  );

  const refreshFx = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await invoke('latest');
      await loadRates();
      if (res?.rate == null) toast.error('All FX sources unavailable — no rate could be retrieved');
      else if (res.stale) toast.warning(`Live sources unreachable — showing cached rate from ${res.date}`);
      else toast.success(`USD-INR ${res.rate.toFixed(4)} · ${res.source}`);
    } catch (e) {
      toast.error(`FX refresh failed: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, [invoke, loadRates]);

  const backfillFx = useCallback(
    async (range = '10y') => {
      setBackfilling(true);
      try {
        const res = await invoke('history', range);
        await loadRates();
        toast.success(`Backfilled ${res?.inserted ?? 0} daily rates · ${res?.source ?? 'unknown'}`);
      } catch (e) {
        toast.error(`FX backfill failed: ${(e as Error).message}`);
      } finally {
        setBackfilling(false);
      }
    },
    [invoke, loadRates]
  );

  // Auto-fetch the latest rate once if the table is empty
  useEffect(() => {
    if (!loadingFx && rates.length === 0 && !refreshing && !backfilling) {
      backfillFx('10y');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingFx]);

  const spotRow = useMemo(() => latestRate(rates), [rates]);
  const spot = spotRow?.rate ?? 0;

  const metrics = useMemo(() => {
    if (!spot) return null;

    const flows = buildUsdCashflows(transactions, rates);
    const holdingRows = holdingsInUsd(holdings, rates, spot);

    const investedUsd = holdingRows.reduce((s, r) => s + r.investedUsd, 0);
    const currentUsd = holdingRows.reduce((s, r) => s + r.currentUsd, 0);
    const investedInr = summary.investedValue;
    const currentInr = summary.currentValue;

    const aumUsd = summary.totalPortfolioValue / spot;
    const attr = attribution(investedInr, currentInr, investedUsd, currentUsd, spot);
    const xirrUsd = usdXirr(flows, currentUsd);

    const oldestTxn = transactions.length
      ? transactions.reduce((a, b) => (new Date(a.date) < new Date(b.date) ? a : b))
      : null;
    const coverageOk = oldestTxn ? !!rateOn(rates, oldestTxn.date)?.exact || rates.length > 200 : true;
    const approximatedCount = holdingRows.filter((r) => r.approximated).length;

    return {
      spot,
      spotSource: spotRow?.source ?? 'unknown',
      spotDate: spotRow?.date ?? '',
      aumUsd,
      investedUsd,
      currentUsd,
      alphaUsd: currentUsd - investedUsd,
      alphaInr: summary.totalPnl,
      inrReturnPct: summary.totalPnlPercent,
      usdReturnPct: attr.totalUsdReturnPct,
      currencyDragPct: attr.totalUsdReturnPct - summary.totalPnlPercent,
      attr,
      xirrInr: summary.xirr != null ? summary.xirr * 100 : null,
      xirrUsd: xirrUsd != null ? xirrUsd * 100 : null,
      flows,
      holdingRows,
      coverageOk,
      approximatedCount,
    };
  }, [spot, spotRow, rates, holdings, summary, transactions]);

  return {
    ...portfolio,
    rates,
    spot,
    spotRow,
    metrics,
    loadingFx,
    refreshing,
    backfilling,
    refreshFx,
    backfillFx,
    lastAttempts,
  };
}
