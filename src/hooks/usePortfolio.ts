import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Transaction, DerivedHolding, PortfolioSummary, CashSettings, CurrentPrices, SymbolMetadata, ExposureBreakdown } from '@/types/portfolio';
import { toast } from 'sonner';
import { calculateXIRR } from '@/lib/xirr';

export function usePortfolio() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cash, setCash] = useState<CashSettings>({ liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 });
  const [currentPrices, setCurrentPrices] = useState<CurrentPrices>({});
  const [symbolMetadata, setSymbolMetadata] = useState<Record<string, SymbolMetadata>>({});
  const [loading, setLoading] = useState(true);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [lastPriceFetchTime, setLastPriceFetchTime] = useState<string | null>(null);

  // Load all data from Supabase on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [txnRes, cashRes, priceRes, metaRes] = await Promise.all([
          supabase.from('transactions').select('*').order('date', { ascending: false }),
          supabase.from('cash_settings').select('*').limit(1).single(),
          supabase.from('current_prices').select('*'),
          supabase.from('symbol_metadata').select('*'),
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
          for (const p of priceRes.data) {
            prices[p.symbol] = Number(p.price);
          }
          setCurrentPrices(prices);
        }

        if (metaRes.data) {
          const meta: Record<string, SymbolMetadata> = {};
          for (const m of metaRes.data) {
            meta[m.symbol] = { symbol: m.symbol, geography: m.geography as SymbolMetadata['geography'], category: m.sector as SymbolMetadata['category'] };
          }
          setSymbolMetadata(meta);
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

  const updateCash = useCallback(async (newCash: Partial<CashSettings>) => {
    const dbUpdates: Record<string, number> = {};
    if (newCash.liquidCash !== undefined) dbUpdates.liquid_cash = newCash.liquidCash;
    if (newCash.vaultCash !== undefined) dbUpdates.vault_cash = newCash.vaultCash;
    if (newCash.pfBalance !== undefined) dbUpdates.pf_balance = newCash.pfBalance;
    if (newCash.creditCardDebt !== undefined) dbUpdates.credit_card_debt = newCash.creditCardDebt;


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
  }, [cash, recordNetWorthSnapshot]);

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
        let count = 0;
        for (const [symbol, price] of Object.entries(prices)) {
          if (price != null) {
            updated[symbol] = price;
            count++;
          }
        }
        setCurrentPrices(updated);
        toast.success(`Updated ${count} price(s) from Yahoo Finance`);
        const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
        setLastPriceFetchTime(now);
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
      let totalQuantity = 0;
      let totalInvested = 0;

      for (const t of txns) {
        if (t.type === 'BUY') {
          totalQuantity += t.quantity;
          totalInvested += t.quantity * t.price;
        } else {
          totalQuantity -= t.quantity;
          totalInvested -= t.quantity * t.price;
        }
      }

      const avgPrice = totalQuantity > 0 ? totalInvested / totalQuantity : 0;
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
    

    // XIRR: build cash flows from all transactions + current portfolio value as terminal flow
    const cashFlows = transactions.map(t => ({
      amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
      date: new Date(t.date),
    }));
    if (currentValue > 0) {
      cashFlows.push({ amount: currentValue, date: new Date() });
    }
    const xirr = calculateXIRR(cashFlows);

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
    };
  }, [holdings, cash, transactions]);

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
    currentPrices,
    symbolMetadata,
    loading,
    fetchingPrices,
    lastPriceFetchTime,
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
