import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Transaction, DerivedHolding, PortfolioSummary, CashSettings, CurrentPrices, SymbolMetadata, ExposureBreakdown, MonthlyCashflow } from '@/types/portfolio';
import { toast } from 'sonner';
import { calculateXIRR } from '@/lib/xirr';
import { computeFifoPosition } from '@/lib/costBasis';
import { getIstYearMonth } from '@/lib/expenseIncomeRatio';
import { logClientError } from '@/lib/clientErrorLogging';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';

function formatIstTimestamp(date: Date): string {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
}

// Reads the active family member selection (a specific family_members.id, or 'all' for the
// combined household view) from FamilyMemberContext rather than taking it as a parameter — every
// existing call site across src/pages keeps calling usePortfolio() unchanged, and a test that
// doesn't wrap a <FamilyMemberProvider> gets the context's default ('all'), matching today's
// single-portfolio behavior exactly. 'all' means every query below reads across every member
// instead of filtering — the existing FIFO/XIRR/exposure derivations already fold all rows into
// one holdings list, which is exactly the correct combined-total behavior with no math changes.
export function usePortfolio() {
  const { activeMemberId } = useFamilyMemberSelection();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cash, setCash] = useState<CashSettings>({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
  const [monthlyCashflow, setMonthlyCashflow] = useState<MonthlyCashflow>({ totalIncome: 0, totalExpense: 0 });
  const [currentPrices, setCurrentPrices] = useState<CurrentPrices>({});
  const [symbolMetadata, setSymbolMetadata] = useState<Record<string, SymbolMetadata>>({});
  const [loading, setLoading] = useState(true);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  // "Checked" bumps on every fetch attempt, regardless of outcome. "Changed"
  // only bumps when a price actually moved and something was written to
  // current_prices — since fetch-prices now skips no-op writes (see
  // docs/scaling-and-archival-plan.md's addendum), these are genuinely
  // different moments, not just two labels for the same event.
  const [lastPriceCheckTime, setLastPriceCheckTime] = useState<string | null>(null);
  const [lastPriceChangeTime, setLastPriceChangeTime] = useState<string | null>(null);

  // Load all data from Supabase on mount, and again whenever the active family member selection
  // changes — a distinct member id filters every per-member table, 'all' fetches every member's
  // rows and folds/sums them into the combined household view.
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        let txnQuery = supabase.from('transactions').select('*').order('date', { ascending: false });
        if (activeMemberId !== 'all') txnQuery = txnQuery.eq('family_member_id', activeMemberId);

        let cashQuery = supabase.from('cash_settings').select('*');
        if (activeMemberId !== 'all') cashQuery = cashQuery.eq('family_member_id', activeMemberId);

        let cashflowQuery = supabase
          .from('monthly_cashflow')
          .select('total_income, total_expense')
          .eq('year_month', getIstYearMonth());
        if (activeMemberId !== 'all') cashflowQuery = cashflowQuery.eq('family_member_id', activeMemberId);

        const [txnRes, cashRes, priceRes, metaRes, cashflowRes] = await Promise.all([
          txnQuery,
          cashQuery,
          supabase.from('current_prices').select('*'),
          supabase.from('symbol_metadata').select('*'),
          cashflowQuery,
        ]);

        // Each of these previously only ever checked `.data` — a real query
        // error left `.data` null/undefined the same as a genuinely empty
        // table, so a failed load of (say) just current_prices silently
        // rendered as "no prices yet" with nothing anywhere to say the query
        // itself had failed. One aggregate toast (not five) plus a per-query
        // trace, so a partial load failure is still visible without being
        // noisy about which specific piece broke.
        const loadErrors = [
          { label: 'transactions', error: txnRes.error },
          { label: 'cash_settings', error: cashRes.error },
          { label: 'current_prices', error: priceRes.error },
          { label: 'symbol_metadata', error: metaRes.error },
          { label: 'monthly_cashflow', error: cashflowRes.error },
        ].filter((r) => r.error);
        if (loadErrors.length > 0) {
          for (const { label, error } of loadErrors) {
            logClientError('usePortfolio.loadData', `Failed to load ${label}`, { error });
          }
          toast.error('Some portfolio data failed to load — figures below may be incomplete');
        }

        if (txnRes.data) {
          setTransactions(txnRes.data.map(t => ({
            id: t.id,
            symbol: t.symbol,
            type: t.type as 'BUY' | 'SELL',
            quantity: Number(t.quantity),
            price: Number(t.price),
            date: t.date,
            familyMemberId: t.family_member_id,
          })));
        }

        // A single member has at most one cash_settings row (UNIQUE(family_member_id)); 'all'
        // sums every member's row into one combined figure.
        if (cashRes.data) {
          const rows = cashRes.data as any[];
          setCash({
            liquidCash: rows.reduce((s, r) => s + Number(r.liquid_cash ?? 0), 0),
            vaultCash: rows.reduce((s, r) => s + Number(r.vault_cash ?? 0), 0),
            pfBalance: rows.reduce((s, r) => s + Number(r.pf_balance ?? 0), 0),
            creditCardDebt: rows.reduce((s, r) => s + Number(r.credit_card_debt ?? 0), 0),
          });
        }

        if (priceRes.data) {
          const prices: CurrentPrices = {};
          let latestUpdate: Date | null = null;
          for (const p of priceRes.data as { symbol: string; price: number; updated_at?: string }[]) {
            prices[p.symbol] = Number(p.price);
            if (p.updated_at) {
              const updatedAt = new Date(p.updated_at);
              if (!latestUpdate || updatedAt > latestUpdate) latestUpdate = updatedAt;
            }
          }
          setCurrentPrices(prices);
          // current_prices.updated_at now only bumps on a real price change
          // (fetch-prices skips no-op writes), so the newest value across all
          // rows is genuinely "last time any price changed" — survives a
          // page reload, unlike lastPriceCheckTime below which is per-session.
          if (latestUpdate) setLastPriceChangeTime(formatIstTimestamp(latestUpdate));
        }

        if (metaRes.data) {
          const meta: Record<string, SymbolMetadata> = {};
          for (const m of metaRes.data) {
            meta[m.symbol] = { symbol: m.symbol, geography: m.geography as SymbolMetadata['geography'], category: m.sector as SymbolMetadata['category'] };
          }
          setSymbolMetadata(meta);
        }

        if (cashflowRes.data) {
          const rows = cashflowRes.data as any[];
          setMonthlyCashflow({
            totalIncome: rows.reduce((s, r) => s + Number(r.total_income ?? 0), 0),
            totalExpense: rows.reduce((s, r) => s + Number(r.total_expense ?? 0), 0),
          });
        }
      } catch (err) {
        console.error('Error loading portfolio data:', err);
        toast.error('Failed to load portfolio data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [activeMemberId]);

  // Compute portfolio value from transactions + prices — still used by
  // other derivations in this hook (not the snapshot path anymore, see
  // below). Mirrored server-side in the record_net_worth_snapshot SQL
  // function (supabase/migrations/20260918110000_...), which computes it
  // straight from the transactions/current_prices tables rather than
  // trusting this closure's (potentially stale) client state.
  const computePortfolioValue = useCallback(() => {
    const bySymbol: Record<string, number> = {};
    for (const t of transactions) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = 0;
      bySymbol[t.symbol] += t.type === 'BUY' ? t.quantity : -t.quantity;
    }
    let total = 0;
    for (const [sym, qty] of Object.entries(bySymbol)) {
      if (qty > 0) total += qty * (currentPrices[sym] || 0);
    }
    return total;
  }, [transactions, currentPrices]);

  // addTransaction/updateTransaction/deleteTransaction/updateCash each used to be 2-4 separate
  // Supabase round trips (the write itself, then a read-then-insert net worth snapshot, then for
  // updateCash a read-then-upsert cashflow delta too) with no transaction boundary tying them
  // together — a mid-sequence failure left partial state, and two tabs editing cash concurrently
  // could silently lose one edit (stale-closure read-modify-write race). All of that now runs
  // inside single Postgres functions (supabase/migrations/20260918110000_...), invoked via
  // supabase.rpc(): a PL/pgSQL function body is one implicit transaction, so each of these is
  // atomic end-to-end, and update_cash_settings_tracked row-locks cash_settings for its duration
  // instead of trusting a client-side "previous value" read moments earlier.

  const addTransaction = useCallback(async (txn: Omit<Transaction, 'id' | 'date' | 'familyMemberId'>) => {
    if (activeMemberId === 'all') {
      toast.error('Select a specific family member before adding a transaction');
      return;
    }

    const { data, error } = await supabase.rpc('add_transaction_and_snapshot', {
      p_family_member_id: activeMemberId,
      p_symbol: txn.symbol,
      p_type: txn.type,
      p_quantity: txn.quantity,
      p_price: txn.price,
      p_liquid_cash: cash.liquidCash,
      p_vault_cash: cash.vaultCash,
      p_pf_balance: cash.pfBalance,
      p_credit_card_debt: cash.creditCardDebt,
    });

    if (error || !data) {
      toast.error('Failed to add transaction');
      console.error(error);
      logClientError('usePortfolio.addTransaction', 'Failed to add transaction', { error, txn });
      return;
    }

    const newTxn: Transaction = {
      id: data.id,
      symbol: data.symbol,
      type: data.type as 'BUY' | 'SELL',
      quantity: Number(data.quantity),
      price: Number(data.price),
      date: data.date,
      familyMemberId: data.family_member_id,
    };
    setTransactions(prev => [newTxn, ...prev]);
    toast.success('Transaction added');
  }, [activeMemberId, cash]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Pick<Transaction, 'quantity' | 'price' | 'date'>>) => {
    // Unlike addTransaction, this is reachable from the combined "All Family" view (the
    // transaction list there spans every member) — snapshot params go through as NULL in that
    // case, same as the original recordNetWorthSnapshot()'s activeMemberId === 'all' early return.
    const snapshotMember = activeMemberId === 'all' ? null : activeMemberId;
    const { error } = await supabase.rpc('update_transaction_and_snapshot', {
      p_id: id,
      p_quantity: updates.quantity ?? null,
      p_price: updates.price ?? null,
      p_date: updates.date ?? null,
      p_family_member_id: snapshotMember,
      p_liquid_cash: snapshotMember ? cash.liquidCash : null,
      p_vault_cash: snapshotMember ? cash.vaultCash : null,
      p_pf_balance: snapshotMember ? cash.pfBalance : null,
      p_credit_card_debt: snapshotMember ? cash.creditCardDebt : null,
    });

    if (error) {
      toast.error('Failed to update transaction');
      console.error(error);
      logClientError('usePortfolio.updateTransaction', 'Failed to update transaction', { error, id, updates });
      return;
    }

    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, [activeMemberId, cash]);

  const deleteTransaction = useCallback(async (id: string) => {
    const snapshotMember = activeMemberId === 'all' ? null : activeMemberId;
    const { error } = await supabase.rpc('delete_transaction_and_snapshot', {
      p_id: id,
      p_family_member_id: snapshotMember,
      p_liquid_cash: snapshotMember ? cash.liquidCash : null,
      p_vault_cash: snapshotMember ? cash.vaultCash : null,
      p_pf_balance: snapshotMember ? cash.pfBalance : null,
      p_credit_card_debt: snapshotMember ? cash.creditCardDebt : null,
    });

    if (error) {
      toast.error('Failed to delete transaction');
      console.error(error);
      logClientError('usePortfolio.deleteTransaction', 'Failed to delete transaction', { error, id });
      return;
    }

    setTransactions(prev => prev.filter(t => t.id !== id));
  }, [activeMemberId, cash]);

  // `excludeFromCashflow` opts a balance edit out of income/expense tracking
  // — for corrections, transfers between the user's own accounts, or any
  // other update that isn't real new income or spending. The bulk data reset
  // always passes this. payCreditCardBill deliberately does NOT: card charges
  // are never tracked as an expense when they're made (see
  // "does not track a credit-card-debt change" in
  // use-portfolio-cashflow-tracking.test.tsx), so the Cash Reserve deduction
  // at settlement time is the only point real money actually leaves — it must
  // count, or the spend never shows up in the Expense-to-Income ratio at all.
  const updateCash = useCallback(async (newCash: Partial<CashSettings>, options?: { excludeFromCashflow?: boolean }) => {
    if (activeMemberId === 'all') {
      toast.error('Select a specific family member before editing cash balances');
      return;
    }

    // Full row, not a partial update: a member may not have a cash_settings row yet (e.g. a
    // freshly-added member), so this upserts on family_member_id rather than assuming a row
    // already exists — unlike the old single-row `.update(...).not('id','is',null)`, which
    // relied on the singleton row seeded by migration always being present.
    const dbRow = {
      liquid_cash: newCash.liquidCash ?? cash.liquidCash,
      vault_cash: newCash.vaultCash ?? cash.vaultCash,
      pf_balance: newCash.pfBalance ?? cash.pfBalance,
      credit_card_debt: newCash.creditCardDebt ?? cash.creditCardDebt,
    };

    // update_cash_settings_tracked (supabase/migrations/20260918110000_...) does the
    // cash_settings upsert, the income/expense delta classification + monthly_cashflow upsert,
    // and the net worth snapshot as one atomic, row-locked operation — see that migration's
    // comment for why this used to be a lost-update race across two tabs.
    const { data, error } = await supabase.rpc('update_cash_settings_tracked', {
      p_family_member_id: activeMemberId,
      p_liquid_cash: dbRow.liquid_cash,
      p_vault_cash: dbRow.vault_cash,
      p_pf_balance: dbRow.pf_balance,
      p_credit_card_debt: dbRow.credit_card_debt,
      p_exclude_from_cashflow: options?.excludeFromCashflow ?? false,
    });

    if (error) {
      toast.error('Failed to update cash');
      console.error(error);
      logClientError('usePortfolio.updateCash', 'Failed to update cash_settings', { error, dbRow });
      return;
    }

    const merged = { ...cash, ...newCash };
    setCash(merged);

    const totals = data?.[0];
    if (totals) {
      setMonthlyCashflow({ totalIncome: Number(totals.total_income), totalExpense: Number(totals.total_expense) });
    }
  }, [cash, activeMemberId]);

  const payCreditCardBill = useCallback(async () => {
    const debt = cash.creditCardDebt;
    if (debt <= 0) {
      toast.info('No outstanding liability to settle');
      return;
    }
    if (cash.vaultCash < debt) {
      toast.error('Insufficient Cash Reserve to settle the liability');
      return;
    }
    const newVault = cash.vaultCash - debt;
    // Counted as an expense (see the comment on updateCash above): charging
    // the card is never tracked, so this Cash Reserve deduction is the only
    // moment the spend becomes visible to the Expense-to-Income ratio.
    await updateCash({ vaultCash: newVault, creditCardDebt: 0 });
    toast.success(`Liability settled — ₹${debt.toLocaleString('en-IN')} deducted from Cash Reserve`);
  }, [cash, updateCash]);

  const updatePrice = useCallback(async (symbol: string, price: number) => {
    const { error } = await supabase
      .from('current_prices')
      .upsert({ symbol, price }, { onConflict: 'symbol' });

    if (error) {
      toast.error('Failed to update price');
      console.error(error);
      logClientError('usePortfolio.updatePrice', 'Failed to update current_prices', { error, symbol, price });
      return;
    }

    setCurrentPrices(prev => ({ ...prev, [symbol]: price }));
  }, []);

  const updateSymbolMetadata = useCallback(async (symbol: string, geography: string, sector: string) => {
    const { error } = await supabase
      .from('symbol_metadata')
      .upsert({ symbol, geography, sector }, { onConflict: 'symbol' });

    if (error) {
      toast.error('Failed to update metadata');
      console.error(error);
      logClientError('usePortfolio.updateSymbolMetadata', 'Failed to update symbol_metadata', { error, symbol, geography, sector });
      return;
    }

    setSymbolMetadata(prev => ({ ...prev, [symbol]: { symbol, geography: geography as SymbolMetadata['geography'], category: sector as SymbolMetadata['category'] } }));
    toast.success(`Updated ${symbol} metadata`);
  }, []);

  const fetchLivePrices = useCallback(async () => {
    const symbols = [...new Set(transactions.map(t => t.symbol))];
    if (symbols.length === 0) return;

    setFetchingPrices(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-prices', {
        body: { symbols },
      });

      if (error) {
        toast.error('Failed to fetch live prices');
        console.error(error);
        logClientError('usePortfolio.fetchLivePrices', 'fetch-prices invocation failed', { error, symbols });
        return;
      }

      // fetch-prices now reports a failed current_prices write explicitly
      // (see supabase/functions/fetch-prices/index.ts's writeError) instead
      // of the caller having no way to tell a persisted write from one that
      // silently didn't happen.
      if (data?.writeError) {
        logClientError('usePortfolio.fetchLivePrices', 'fetch-prices reported a write error', { writeError: data.writeError, symbols });
      }

      const prices = data?.prices as Record<string, number | null>;
      if (prices) {
        const updated = { ...currentPrices };
        for (const [symbol, price] of Object.entries(prices)) {
          if (price != null) updated[symbol] = price;
        }
        setCurrentPrices(updated);

        // fetch-prices only writes to current_prices when a price actually
        // moved (see docs/scaling-and-archival-plan.md's addendum) — reflect
        // that honestly instead of implying every checked symbol got a
        // fresh DB row.
        const changed = (data?.changed as string[] | undefined) ?? Object.keys(prices).filter((s) => prices[s] != null);
        const unchanged = (data?.unchanged as string[] | undefined) ?? [];
        if (data?.writeError) {
          toast.error('Prices fetched but failed to save — try again shortly');
        } else if (changed.length === 0) {
          toast.success(unchanged.length > 0 ? `Checked ${unchanged.length} price(s) — no change, nothing written` : 'No prices to check');
        } else if (unchanged.length > 0) {
          toast.success(`Updated ${changed.length} price(s), ${unchanged.length} unchanged — no DB write needed for those`);
        } else {
          toast.success(`Updated ${changed.length} price(s) from Yahoo Finance`);
        }

        const now = new Date();
        setLastPriceCheckTime(formatIstTimestamp(now));
        if (changed.length > 0) setLastPriceChangeTime(formatIstTimestamp(now));
      }
    } catch (err) {
      console.error('Error fetching live prices:', err);
      toast.error('Failed to fetch live prices');
      logClientError('usePortfolio.fetchLivePrices', 'Unhandled error fetching live prices', { error: err, symbols });
    } finally {
      setFetchingPrices(false);
    }
  }, [transactions, currentPrices]);

  const resetAll = useCallback(async () => {
    // reset_all_data (supabase/migrations/20260918110000_...) runs all four wipes in one
    // Postgres function/transaction — the previous Promise.all fired them concurrently with no
    // rollback, so a mid-sequence failure (e.g. cash_settings' update rejected after transactions
    // had already been deleted) could leave a genuinely mixed, irreversible partial reset.
    const { error } = await supabase.rpc('reset_all_data');

    if (error) {
      logClientError('usePortfolio.resetAll', 'Failed to reset data', { error });
      toast.error('Failed to reset data');
      return;
    }

    setTransactions([]);
    setCash({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
    setCurrentPrices({});
    setMonthlyCashflow({ totalIncome: 0, totalExpense: 0 });
    toast.success('All data reset');
  }, []);

  // Derive holdings from transactions
  const holdings: DerivedHolding[] = useMemo(() => {
    const bySymbol: Record<string, Transaction[]> = {};
    for (const txn of transactions) {
      if (!bySymbol[txn.symbol]) bySymbol[txn.symbol] = [];
      bySymbol[txn.symbol].push(txn);
    }

    return Object.entries(bySymbol).map(([symbol, txns]) => {
      // FIFO cost basis — a SELL consumes the oldest open BUY lot(s) first,
      // so "Invested" reflects the actual cost of the shares still held,
      // not the sell's proceeds. See src/lib/costBasis.ts.
      const { totalQuantity, totalInvested, avgPrice } = computeFifoPosition(txns);
      const cp = currentPrices[symbol] || 0;
      const currentValue = cp * totalQuantity;
      const pnl = currentValue - totalInvested;
      const pnlPercent = totalInvested !== 0 ? (pnl / totalInvested) * 100 : 0;

      const meta = symbolMetadata[symbol];
      return {
        symbol,
        totalQuantity,
        totalInvested,
        avgPrice,
        currentPrice: cp,
        currentValue,
        pnl,
        pnlPercent,
        geography: meta?.geography,
          category: meta?.category,
        transactions: [...txns].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      };
    }).filter(h => h.totalQuantity > 0);
  }, [transactions, currentPrices, symbolMetadata]);

  // Invested/current totals in a single pass, memoized on `holdings` alone.
  // Split out of `summary` so the two figures every other derivation needs
  // aren't recomputed by a `cash` edit that can't possibly change them.
  const holdingsTotals = useMemo(() => {
    let investedValue = 0;
    let currentValue = 0;
    for (const h of holdings) {
      investedValue += h.totalInvested;
      currentValue += h.currentValue;
    }
    return { investedValue, currentValue };
  }, [holdings]);

  // XIRR lives in its own memo, deliberately NOT depending on `cash`.
  //
  // This used to be computed inline in `summary`, whose dependency array
  // includes `cash` — so editing a bank balance, settling a credit-card bill,
  // or updating the PF figure re-ran Newton-Raphson over the entire
  // transaction history even though none of those values appear anywhere in
  // the cash flows below. `holdings` (and so `holdingsTotals`) depends only on
  // transactions/prices/metadata, so this now recomputes exactly when the
  // inputs it actually reads change.
  //
  // A side effect worth naming: the terminal flow's `new Date()` is now
  // sampled less often. That's the more honest behavior, not a regression —
  // an XIRR shouldn't shift just because the user corrected a cash balance.
  const xirrFigures = useMemo<Pick<PortfolioSummary, 'xirr' | 'xirrExPf'>>(() => {
    // Cash flows from all transactions + current portfolio value as terminal flow.
    // Note: this never includes the manual PF (PPF/EPF) balance in cash_settings — it has no
    // dated contribution history, so there are no cash flows to build for it. See the note on
    // PortfolioSummary.xirrExPf in src/types/portfolio.ts.
    const cashFlows = transactions.map(t => ({
      amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
      date: new Date(t.date),
    }));
    if (holdingsTotals.currentValue > 0) {
      cashFlows.push({ amount: holdingsTotals.currentValue, date: new Date() });
    }
    const xirr = calculateXIRR(cashFlows);

    // xirrExPf: identical to `xirr` today (no transaction-backed holding is tagged PPF/EPF), but
    // computed independently so it automatically diverges the moment one is — rather than silently
    // staying wrong if that ever changes. See src/types/portfolio.ts.
    const isPfTagged = (symbol: string) => symbolMetadata[symbol]?.category === 'PPF / EPF';
    const hasPfHoldings = transactions.some(t => isPfTagged(t.symbol));
    let xirrExPf = xirr;
    if (hasPfHoldings) {
      const exPfCashFlows = transactions
        .filter(t => !isPfTagged(t.symbol))
        .map(t => ({
          amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
          date: new Date(t.date),
        }));
      const exPfCurrentValue = holdings.filter(h => !isPfTagged(h.symbol)).reduce((s, h) => s + h.currentValue, 0);
      if (exPfCurrentValue > 0) {
        exPfCashFlows.push({ amount: exPfCurrentValue, date: new Date() });
      }
      xirrExPf = calculateXIRR(exPfCashFlows);
    }

    return { xirr, xirrExPf };
  }, [transactions, symbolMetadata, holdings, holdingsTotals]);

  // What's left here is arithmetic on already-derived values — cheap enough to
  // re-run on any `cash` change, which it genuinely has to.
  const summary: PortfolioSummary = useMemo(() => {
    const { investedValue, currentValue } = holdingsTotals;
    const totalPnl = currentValue - investedValue;
    const totalPnlPercent = investedValue !== 0 ? (totalPnl / investedValue) * 100 : 0;
    const totalPortfolioValue = currentValue + cash.liquidCash + cash.vaultCash + cash.pfBalance - cash.creditCardDebt;

    return {
      investedValue,
      currentValue,
      totalPnl,
      totalPnlPercent,
      liquidCash: cash.liquidCash,
      vaultCash: cash.vaultCash,
      pfBalance: cash.pfBalance,
      creditCardDebt: cash.creditCardDebt,
      totalPortfolioValue,
      xirr: xirrFigures.xirr,
      xirrExPf: xirrFigures.xirrExPf,
    };
  }, [holdingsTotals, cash, xirrFigures]);

  const topMovers = useMemo(() => {
    const valid = holdings.filter(h => h.totalQuantity > 0 && h.avgPrice > 0 && h.currentPrice > 0);
    const sorted = [...valid].sort((a, b) => b.pnlPercent - a.pnlPercent);
    return {
      gainers: sorted.slice(0, 3),
      losers: sorted.slice(-3).reverse().filter(h => h.pnlPercent < 0),
    };
  }, [holdings]);

  // The holdings half of the exposure breakdown, memoized on `holdings` alone.
  // Previously `buildBreakdown` was called twice inside the `exposure` memo —
  // two full passes over every holding — and that memo depends on `cash`, so
  // both passes re-ran on every cash edit even though cash only ever
  // contributes its own aggregate to the groups afterwards. One pass now,
  // reused until holdings themselves change.
  const exposureGroups = useMemo(() => {
    const geography: Record<string, number> = {};
    const category: Record<string, number> = {};
    for (const h of holdings) {
      const g = h.geography || 'Untagged';
      const c = h.category || 'Untagged';
      geography[g] = (geography[g] || 0) + h.currentValue;
      category[c] = (category[c] || 0) + h.currentValue;
    }
    return { geography, category };
  }, [holdings]);

  const exposure = useMemo(() => {
    const cashTotal = (cash.liquidCash || 0) + (cash.vaultCash || 0);
    const pfTotal = cash.pfBalance || 0;

    const buildBreakdown = (key: 'geography' | 'category'): ExposureBreakdown[] => {
      // Copied, never mutated in place: `exposureGroups` is a memoized value
      // reused across renders, so folding cash into it directly would
      // double-count on the next cash-only recompute.
      const groups: Record<string, number> = { ...exposureGroups[key] };
      if (key === 'category') {
        if (cashTotal > 0) groups['Cash'] = (groups['Cash'] || 0) + cashTotal;
        if (pfTotal > 0) groups['PPF / EPF'] = (groups['PPF / EPF'] || 0) + pfTotal;
      } else if (key === 'geography') {
        // Cash & PF are India-based holdings
        const indiaAdd = cashTotal + pfTotal;
        if (indiaAdd > 0) groups['India'] = (groups['India'] || 0) + indiaAdd;
      }
      const total = Object.values(groups).reduce((s, v) => s + v, 0);
      return Object.entries(groups)
        .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
        .sort((a, b) => b.value - a.value);
    };
    return { geography: buildBreakdown('geography'), category: buildBreakdown('category') };
  }, [exposureGroups, cash]);

  return {
    transactions,
    holdings,
    summary,
    topMovers,
    exposure,
    cash,
    monthlyCashflow,
    currentPrices,
    symbolMetadata,
    loading,
    fetchingPrices,
    lastPriceCheckTime,
    lastPriceChangeTime,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateCash,
    payCreditCardBill,
    updatePrice,
    updateSymbolMetadata,
    fetchLivePrices,
    resetAll,
  };
}
