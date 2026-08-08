import { useCallback, useMemo } from 'react';
import { SummaryBar } from '@/components/SummaryBar';
import { HoldingsTable } from '@/components/HoldingsTable';
import { TopMovers } from '@/components/TopMovers';
import { RecentActivity } from '@/components/RecentActivity';
import { SIPSummary } from '@/components/SIPSummary';
import { CashSection } from '@/components/CashSection';
import { AddTransactionForm } from '@/components/AddTransactionForm';
import { ExposureSection } from '@/components/ExposureSection';
import { DollarReturnsCard } from '@/components/DollarReturnsCard';


import { DebtChart } from '@/components/DebtChart';
import { usePortfolio } from '@/hooks/usePortfolio';
import { RefreshCw, Eye, EyeOff, CreditCard, AlertTriangle } from 'lucide-react';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { SiteFooter } from '@/components/SiteFooter';
import { getDynamicGreeting } from '@/lib/greeting';

const IndexContent = () => {
  const { hidden, toggle } = usePrivacy();

  const {
    transactions,
    holdings,
    summary,
    topMovers,
    exposure,
    cash,
    loading,
    fetchingPrices,
    lastPriceFetchTime,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateCash,
    updatePrice,
    updateSymbolMetadata,
    fetchLivePrices,
    payCreditCardBill,
  } = usePortfolio();

  const bumpRefresh = useCallback(() => {}, []);

  const handleAddTransaction = useCallback(async (txn: any) => {
    await addTransaction(txn); bumpRefresh();
  }, [addTransaction, bumpRefresh]);

  const handleUpdateTransaction = useCallback(async (id: string, updates: any) => {
    await updateTransaction(id, updates); bumpRefresh();
  }, [updateTransaction, bumpRefresh]);

  const handleDeleteTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id); bumpRefresh();
  }, [deleteTransaction, bumpRefresh]);

  const handleUpdateCash = useCallback(async (newCash: any) => {
    await updateCash(newCash); bumpRefresh();
  }, [updateCash, bumpRefresh]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading portfolio...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        <div className="flex items-center justify-end gap-1 -mb-2">
          <button
            onClick={fetchLivePrices}
            disabled={fetchingPrices || holdings.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={lastPriceFetchTime ? `Last updated: ${lastPriceFetchTime}` : 'Fetch live prices'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetchingPrices ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{fetchingPrices ? 'Fetching…' : 'Prices'}</span>
          </button>
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={hidden ? 'Show values' : 'Hide values'}
          >
            {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Welcome */}
        <DynamicWelcome />

        {/* CC Bill Reminder — first 5 days of month while debt is outstanding */}
        {cash.creditCardDebt > 0 && new Date().getDate() <= 5 && (
          <div className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-loss mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Credit card bill due this month</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                ICICI Platinum Chip Credit Card — outstanding liability pending. Settle it from Cash Reserve to clear.
              </p>
            </div>
            <button
              onClick={payCreditCardBill}
              disabled={cash.vaultCash < cash.creditCardDebt}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <CreditCard className="w-3.5 h-3.5" /> Settle Now
            </button>
          </div>
        )}

        {/* Summary */}
        <SummaryBar summary={summary} />

        {/* Dollar-Adjusted Returns overview */}
        <DollarReturnsCard holdings={holdings} summary={summary} />

        {/* Cash Management — image-2 inspired card grid */}
        <CashSection cash={cash} onUpdate={handleUpdateCash} onPayCreditCard={payCreditCardBill} />

        {/* Debt % vs Net Worth */}
        <DebtChart refreshKey={0} />

        {/* Add Transaction */}
        <AddTransactionForm onAdd={handleAddTransaction} />

        {/* Holdings */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Holdings (Derived from Transactions)</h2>
          <HoldingsTable
            holdings={holdings}
            onUpdatePrice={updatePrice}
            onUpdateTransaction={handleUpdateTransaction}
            onDeleteTransaction={handleDeleteTransaction}
            onUpdateMetadata={updateSymbolMetadata}
          />
        </div>

        {/* Exposure */}
        <ExposureSection geography={exposure.geography} category={exposure.category} />

        {/* Recent Activity */}
        <RecentActivity transactions={transactions} />

        {/* SIP Summary */}
        <SIPSummary transactions={transactions} />

        {/* Top Movers */}
        <TopMovers gainers={topMovers.gainers} losers={topMovers.losers} />
      </div>
      <SiteFooter />
    </div>
  );
};

function DynamicWelcome() {
  const greeting = useMemo(() => getDynamicGreeting(), []);
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="flex items-end justify-between flex-wrap gap-3 px-1">
      <div>
        <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-2 font-mono">{dateStr}</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
          {greeting.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
          {greeting.subtitle}
        </p>
      </div>
    </div>
  );
}

const Index = () => (
  <PrivacyProvider>
    <IndexContent />
  </PrivacyProvider>
);

export default Index;
