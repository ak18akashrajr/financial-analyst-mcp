import { RefreshCw } from 'lucide-react';

interface Props {
  fetchingPrices: boolean;
  disabled: boolean;
  /** Last time a fetch was attempted, regardless of whether any price moved. */
  lastPriceCheckTime: string | null;
  /** Last time a fetch actually found a moved price and wrote it to
   * current_prices — distinct from lastPriceCheckTime since fetch-prices
   * skips no-op writes (see docs/scaling-and-archival-plan.md's addendum).
   * Survives a page reload (derived from the DB's own updated_at), unlike
   * lastPriceCheckTime which resets per session. */
  lastPriceChangeTime: string | null;
  onClick: () => void;
}

/** The "Prices" refresh button on the dashboard header, plus explicit
 * "checked" / "changed" timestamps shown below it — previously a single
 * "last updated" line that conflated "we asked Yahoo" with "a price
 * actually moved," which stopped being the same event once unchanged
 * prices stopped writing to the DB. */
export function PriceRefreshButton({ fetchingPrices, disabled, lastPriceCheckTime, lastPriceChangeTime, onClick }: Props) {
  const title = lastPriceCheckTime
    ? `Last checked: ${lastPriceCheckTime}${lastPriceChangeTime ? ` · Last price change: ${lastPriceChangeTime}` : ''}`
    : 'Fetch live prices';

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={onClick}
        disabled={fetchingPrices || disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={title}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${fetchingPrices ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{fetchingPrices ? 'Fetching…' : 'Prices'}</span>
      </button>
      {lastPriceCheckTime && (
        <span className="text-[10px] text-muted-foreground pr-1">Checked {lastPriceCheckTime}</span>
      )}
      {lastPriceChangeTime && (
        <span className="text-[10px] text-muted-foreground pr-1">Changed {lastPriceChangeTime}</span>
      )}
    </div>
  );
}
