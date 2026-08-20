import { RefreshCw } from 'lucide-react';

interface Props {
  fetchingPrices: boolean;
  disabled: boolean;
  lastPriceFetchTime: string | null;
  onClick: () => void;
}

/** The "Prices" refresh button on the dashboard header, plus an explicit
 * last-updated timestamp shown below it — previously only available on
 * hover via the button's title attribute. */
export function PriceRefreshButton({ fetchingPrices, disabled, lastPriceFetchTime, onClick }: Props) {
  return (
    <div className="flex flex-col items-end">
      <button
        onClick={onClick}
        disabled={fetchingPrices || disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={lastPriceFetchTime ? `Last updated: ${lastPriceFetchTime}` : 'Fetch live prices'}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${fetchingPrices ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{fetchingPrices ? 'Fetching…' : 'Prices'}</span>
      </button>
      {lastPriceFetchTime && (
        <span className="text-[10px] text-muted-foreground pr-1">Updated {lastPriceFetchTime}</span>
      )}
    </div>
  );
}
