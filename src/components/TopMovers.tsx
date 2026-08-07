import type { DerivedHolding } from '@/types/portfolio';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  gainers: DerivedHolding[];
  losers: DerivedHolding[];
}

function MoverCard({ holding, type }: { holding: DerivedHolding; type: 'gain' | 'loss' }) {
  const { mask } = usePrivacy();
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
      <div>
        <p className="font-medium text-sm text-foreground">{holding.symbol}</p>
        <p className="text-xs text-muted-foreground">{mask(fmtRaw(holding.currentPrice))}</p>
      </div>
      <div className={`text-right flex items-center gap-1 ${type === 'gain' ? 'text-gain' : 'text-loss'}`}>
        {type === 'gain' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        <span className="text-sm font-semibold">{holding.pnlPercent.toFixed(2)}%</span>
      </div>
    </div>
  );
}

export function TopMovers({ gainers, losers }: Props) {
  if (gainers.length === 0 && losers.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {gainers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gain mb-2 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" /> Top Gainers
          </h3>
          <div className="space-y-2">
            {gainers.map((h) => <MoverCard key={h.symbol} holding={h} type="gain" />)}
          </div>
        </div>
      )}
      {losers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-loss mb-2 flex items-center gap-1">
            <TrendingDown className="w-4 h-4" /> Top Losers
          </h3>
          <div className="space-y-2">
            {losers.map((h) => <MoverCard key={h.symbol} holding={h} type="loss" />)}
          </div>
        </div>
      )}
    </div>
  );
}
