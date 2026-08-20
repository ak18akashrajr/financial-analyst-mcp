import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PortfolioCharts } from '@/components/PortfolioCharts';
import { NetWorthChart } from '@/components/NetWorthChart';
import { DebtChart } from '@/components/DebtChart';
import { PerformanceAttribution } from '@/components/PerformanceAttribution';
import { SeasonalityHeatmap } from '@/components/SeasonalityHeatmap';
import { CorrelationHeatmap } from '@/components/CorrelationHeatmap';
import { ThemeToggle } from '@/components/ThemeToggle';
import { usePortfolio } from '@/hooks/usePortfolio';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';

const ChartsContent = () => {
  const { hidden, toggle } = usePrivacy();
  const [netWorthRefreshKey, setNetWorthRefreshKey] = useState(0);

  const {
    transactions,
    holdings,
    summary,
    cash,
    currentPrices,
    loading,
  } = usePortfolio();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading charts...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Portfolio Charts</h1>
              <p className="text-xs text-muted-foreground">Performance & AUM visualizations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
            >
              {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {hidden ? 'Show' : 'Hide'}
            </button>
          </div>
        </div>

        {/* Net Worth Chart */}
        <NetWorthChart
          currentNetWorth={summary.totalPortfolioValue}
          portfolioValue={summary.currentValue}
          liquidCash={cash.liquidCash}
          vaultCash={cash.vaultCash}
          refreshKey={netWorthRefreshKey}
          transactions={transactions}
        />

        {/* Debt % vs Net Worth */}
        <DebtChart refreshKey={netWorthRefreshKey} />

        {/* Performance Charts */}
        <PortfolioCharts transactions={transactions} currentPrices={currentPrices} />

        {/* Performance Attribution */}
        <PerformanceAttribution holdings={holdings} />

        {/* Seasonality + Correlation */}
        <SeasonalityHeatmap />
        <CorrelationHeatmap />
      </div>
    </div>
  );
};

const Charts = () => (
  <PrivacyProvider>
    <ChartsContent />
  </PrivacyProvider>
);

export default Charts;
