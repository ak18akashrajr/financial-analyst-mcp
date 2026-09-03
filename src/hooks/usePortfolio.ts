import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Transaction, DerivedHolding, PortfolioSummary, CashSettings, CurrentPrices, SymbolMetadata, ExposureBreakdown, MonthlyCashflow } from '@/types/portfolio';
import { toast } from 'sonner';
import { calculateXIRR } from '@/lib/xirr';
import { computeFifoPosition } from '@/lib/costBasis';
import { isSameIstCalendarDay, shouldSkipNetWorthSnapshot, type NetWorthSnapshotFields } from '@/lib/netWorthSnapshot';
import { classifyBalanceDelta, getIstYearMonth } from '@/lib/expenseIncomeRatio';

function formatIstTimestamp(date: Date): string {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function usePortfolio() {
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

  // Load all data from Supabase on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [txnRes, cashRes, priceRes, metaRes, cashflowRes] = await Promise.all([
          supabase.from('transactions').select('*').order('date', { ascending: false }),
          supabase.from('cash_settings').select('*').limit(1).single(),
          supabase.from('current_prices').select('*'),
          supabase.from('symbol_metadata').select('*'),
          supabase.from('monthly_cashflow').select('total_income, total_expense').eq('year_month', getIstYearMonth()).maybeSingle(),
        ]);

        if (txnRes.data) {
          setTransactions(txnRes.data.map(t => ({
            id: t.id,
            symbol: t.symbol,
            type: t.type as 'BUY' | 'SELL',
            quantity: Number(t.quantity),
            price: Number(t.price),
            date: t.date,
          })));
        }

        if (cashRes.data) {
          setCash({
            liquidCash: Number(cashRes.data.liquid_cash),
            vaultCash: Number(cashRes.data.vault_cash),
            pfBalance: Number((cashRes.data as any).pf_balance ?? 0),
            creditCardDebt: Number((cashRes.data as any).credit_card_debt ?? 0),
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
          setMonthlyCashflow({
            totalIncome: Number((cashflowRes.data as any).total_income ?? 0),
            totalExpense: Number((cashflowRes.data as any).total_expense ?? 0),
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
  }, []);

  // Compute portfolio value from transactions + prices for snapshot recording
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

  // Record a net worth snapshot to history
  const recordNetWorthSnapshot = useCallback(async (overrideCash?: Partial<CashSettings>) => {
    const lc = overrideCash?.liquidCash ?? cash.liquidCash;
    const vc = overrideCash?.vaultCash ?? cash.vaultCash;
    const pf = overrideCash?.pfBalance ?? cash.pfBalance;
    const ccd = overrideCash?.creditCardDebt ?? cash.creditCardDebt;
    const portfolioVal = computePortfolioValue();
    const netWorth = portfolioVal + lc + vc + pf - ccd;
    const candidate: NetWorthSnapshotFields = {
      netWorth,
      portfolioValue: portfolioVal,
      liquidCash: lc,
      vaultCash: vc,
      pfBalance: pf,
      creditCardDebt: ccd,
    };

    // Skip the insert if it'd be a no-op: same figures already recorded
    // today. A stale snapshot from an earlier day never blocks today's
    // first write — see docs/perf-findings.md#1.
    const { data: latest } = await supabase
      .from('net_worth_history')
      .select('net_worth, portfolio_value, liquid_cash, vault_cash, pf_balance, credit_card_debt, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const mostRecentToday: NetWorthSnapshotFields | null =
      latest && isSameIstCalendarDay(new Date((latest as any).recorded_at), new Date())
        ? {
            netWorth: Number((latest as any).net_worth),
            portfolioValue: Number((latest as any).portfolio_value),
            liquidCash: Number((latest as any).liquid_cash),
            vaultCash: Number((latest as any).vault_cash),
            pfBalance: Number((latest as any).pf_balance),
            creditCardDebt: Number((latest as any).credit_card_debt),
          }
        : null;

    if (shouldSkipNetWorthSnapshot(candidate, mostRecentToday)) return;

    await supabase.from('net_worth_history').insert({
      net_worth: netWorth,
      portfolio_value: portfolioVal,
      liquid_cash: lc,
      vault_cash: vc,
      pf_balance: pf,
      credit_card_debt: ccd,
    } as any);
  }, [cash, computePortfolioValue]);

  const addTransaction = useCallback(async (txn: Omit<Transaction, 'id' | 'date'>) => {
    const { data, error } = await supabase
      .from('transactions')
      .insert({ symbol: txn.symbol, type: txn.type, quantity: txn.quantity, price: txn.price })
      .select()
      .single();

    if (error) {
      toast.error('Failed to add transaction');
      console.error(error);
      return;
    }

    const newTxn: Transaction = {
      id: data.id,
      symbol: data.symbol,
      type: data.type as 'BUY' | 'SELL',
      quantity: Number(data.quantity),
      price: Number(data.price),
      date: data.date,
    };
    setTransactions(prev => [newTxn, ...prev]);
    toast.success('Transaction added');
    await recordNetWorthSnapshot();
  }, [recordNetWorthSnapshot]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Pick<Transaction, 'quantity' | 'price'>>) => {
    const { error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update transaction');
      console.error(error);
      return;
    }

    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    await recordNetWorthSnapshot();
  }, [recordNetWorthSnapshot]);

  const deleteTransaction = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete transaction');
      console.error(error);
      return;
    }

    setTransactions(prev => prev.filter(t => t.id !== id));
    await recordNetWorthSnapshot();
  }, [recordNetWorthSnapshot]);

  // Adds a signed income/expense delta to the current IST calendar month's
  // monthly_cashflow row (creating it if this is the first update this
  // month — a new month simply has no row yet, so tracking "resets"
  // automatically with no cron job). No-ops if both deltas are zero, so
  // callers don't need to guard the call themselves.
  const recordCashflowDelta = useCallback(async (deltaIncome: number, deltaExpense: number) => {
    if (deltaIncome === 0 && deltaExpense === 0) return;

    const yearMonth = getIstYearMonth();
    const { data: existing } = await supabase
      .from('monthly_cashflow')
      .select('total_income, total_expense')
      .eq('year_month', yearMonth)
      .maybeSingle();

    const newIncome = Number((existing as any)?.total_income ?? 0) + deltaIncome;
    const newExpense = Number((existing as any)?.total_expense ?? 0) + deltaExpense;

    const { error } = await supabase
      .from('monthly_cashflow')
      .upsert({ year_month: yearMonth, total_income: newIncome, total_expense: newExpense } as any, { onConflict: 'year_month' });

    if (error) {
      console.error('Failed to record income/expense delta:', error);
      return;
    }
    setMonthlyCashflow({ totalIncome: newIncome, totalExpense: newExpense });
  }, []);

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
    const dbUpdates: {
      liquid_cash?: number;
      vault_cash?: number;
      pf_balance?: number;
      credit_card_debt?: number;
    } = {};
    if (newCash.liquidCash !== undefined) dbUpdates.liquid_cash = newCash.liquidCash;
    if (newCash.vaultCash !== undefined) dbUpdates.vault_cash = newCash.vaultCash;
    if (newCash.pfBalance !== undefined) dbUpdates.pf_balance = newCash.pfBalance;
    if (newCash.creditCardDebt !== undefined) dbUpdates.credit_card_debt = newCash.creditCardDebt;

    // Only Operating Cash (liquidCash) and Cash Reserve (vaultCash) are real
    // bank balances for income/expense purposes — PF and credit-card-debt
    // never feed the ratio. Computed against the pre-update `cash` closure,
    // before the DB write, so it reflects the actual delta being applied.
    let deltaIncome = 0;
    let deltaExpense = 0;
    if (!options?.excludeFromCashflow) {
      if (newCash.liquidCash !== undefined) {
        const d = classifyBalanceDelta(cash.liquidCash, newCash.liquidCash);
        deltaIncome += d.income;
        deltaExpense += d.expense;
      }
      if (newCash.vaultCash !== undefined) {
        const d = classifyBalanceDelta(cash.vaultCash, newCash.vaultCash);
        deltaIncome += d.income;
        deltaExpense += d.expense;
      }
    }

    const { error } = await supabase
      .from('cash_settings')
      .update(dbUpdates)
      .not('id', 'is', null);

    if (error) {
      toast.error('Failed to update cash');
      console.error(error);
      return;
    }

    const merged = { ...cash, ...newCash };
    setCash(merged);

    // Record net worth snapshot with updated cash
    await recordNetWorthSnapshot(newCash);
    await recordCashflowDelta(deltaIncome, deltaExpense);
  }, [cash, recordNetWorthSnapshot, recordCashflowDelta]);

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
        return;
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
        if (changed.length === 0) {
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
    } finally {
      setFetchingPrices(false);
    }
  }, [transactions, currentPrices]);

  const resetAll = useCallback(async () => {
    const [txnRes, cashRes, priceRes] = await Promise.all([
      supabase.from('transactions').delete().not('id', 'is', null),
      supabase.from('cash_settings').update({ liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 } as any).not('id', 'is', null),
      supabase.from('current_prices').delete().not('symbol', 'is', null),
    ]);

    if (txnRes.error || cashRes.error || priceRes.error) {
      toast.error('Failed to reset data');
      return;
    }

    setTransactions([]);
    setCash({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
    setCurrentPrices({});
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

  const summary: PortfolioSummary = useMemo(() => {
    const investedValue = holdings.reduce((s, h) => s + h.totalInvested, 0);
    const currentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
    const totalPnl = currentValue - investedValue;
    const totalPnlPercent = investedValue !== 0 ? (totalPnl / investedValue) * 100 : 0;
    const totalPortfolioValue = currentValue + cash.liquidCash + cash.vaultCash + cash.pfBalance - cash.creditCardDebt;
    

    // XIRR: build cash flows from all transactions + current portfolio value as terminal flow.
    // Note: this never includes the manual PF (PPF/EPF) balance in cash_settings — it has no
    // dated contribution history, so there are no cash flows to build for it. See the note on
    // PortfolioSummary.xirrExPf in src/types/portfolio.ts.
    const cashFlows = transactions.map(t => ({
      amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
      date: new Date(t.date),
    }));
    if (currentValue > 0) {
      cashFlows.push({ amount: currentValue, date: new Date() });
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
      xirr,
      xirrExPf,
    };
  }, [holdings, cash, transactions, symbolMetadata]);

  const topMovers = useMemo(() => {
    const valid = holdings.filter(h => h.totalQuantity > 0 && h.avgPrice > 0 && h.currentPrice > 0);
    const sorted = [...valid].sort((a, b) => b.pnlPercent - a.pnlPercent);
    return {
      gainers: sorted.slice(0, 3),
      losers: sorted.slice(-3).reverse().filter(h => h.pnlPercent < 0),
    };
  }, [holdings]);

  const exposure = useMemo(() => {
    const cashTotal = (cash.liquidCash || 0) + (cash.vaultCash || 0);
    const pfTotal = cash.pfBalance || 0;

    const buildBreakdown = (key: 'geography' | 'category'): ExposureBreakdown[] => {
      const groups: Record<string, number> = {};
      for (const h of holdings) {
        const label = h[key] || 'Untagged';
        groups[label] = (groups[label] || 0) + h.currentValue;
      }
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
  }, [holdings, cash]);

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
