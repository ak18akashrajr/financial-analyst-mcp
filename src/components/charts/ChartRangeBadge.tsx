import { ReferenceArea } from 'recharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { RangeSelection } from '@/hooks/useChartRangeSelection';
import type { RangeReturnResult } from '@/lib/chartRange';

export type ChartRangeUnit = 'currency' | 'rate' | 'percent';

function defaultFormatValue(value: number, unit: ChartRangeUnit): string {
  switch (unit) {
    case 'currency':
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(value);
    case 'rate':
    case 'percent':
      return `${value.toFixed(2)}%`;
  }
}

/**
 * Formats the change itself. For 'rate'/'percent' series (e.g. rolling XIRR, FIRE percentile
 * bands) the delta is expressed in percentage points ("pp"), not "% of %", since a relative
 * percent change of a percentage figure is easy to misread as something else.
 */
function formatChange(result: RangeReturnResult, unit: ChartRangeUnit): string {
  if (result.changePercent === null) return '—';
  if (unit === 'rate' || unit === 'percent') {
    const deltaPoints = result.endValue - result.startValue;
    const sign = deltaPoints >= 0 ? '+' : '';
    return `${sign}${deltaPoints.toFixed(2)}pp`;
  }
  const pct = result.changePercent * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Renders the translucent drag-highlight inside a recharts chart. Place as a chart child.
 * `x1`/`x2` must be the *raw* value of the XAxis's `dataKey` field (not a stringified label) so
 * recharts' category-axis lookup — which matches by strict equality against the axis domain — finds
 * it; e.g. a numeric `month` dataKey needs a number here, not `String(month)`. `result`'s
 * `startLabel`/`endLabel` are display-formatted strings and are NOT safe to reuse for this, so this
 * component takes the underlying `data`/`labelKey` directly instead.
 */
export function ChartRangeReferenceArea<T>({
  selection,
  data,
  labelKey,
}: {
  selection: RangeSelection;
  data: ReadonlyArray<T>;
  labelKey: keyof T;
}) {
  if (selection.startIndex === null || selection.endIndex === null) return null;
  if (selection.startIndex === selection.endIndex) return null;
  if (selection.startIndex < 0 || selection.endIndex >= data.length) return null;
  return (
    <ReferenceArea
      x1={data[selection.startIndex][labelKey] as string | number}
      x2={data[selection.endIndex][labelKey] as string | number}
      strokeOpacity={0.4}
      stroke="hsl(213, 75%, 55%)"
      fill="hsl(213, 75%, 55%)"
      fillOpacity={0.12}
    />
  );
}

interface ChartRangeBadgeProps {
  selection: RangeSelection;
  result: RangeReturnResult | null;
  onClear: () => void;
  unit?: ChartRangeUnit;
  formatValue?: (value: number) => string;
  /** Label for the value rows, e.g. "AUM", "XIRR", "USD-INR rate". Defaults to "Value". */
  valueLabel?: string;
}

/**
 * Floating overlay badge showing the point-to-point return for a drag-selected range. Render as a
 * sibling of <ResponsiveContainer> inside a `position: relative` wrapper (not inside the chart's
 * SVG) so it can render as regular DOM/CSS rather than SVG.
 */
export function ChartRangeBadge({
  selection,
  result,
  onClear,
  unit = 'currency',
  formatValue,
  valueLabel = 'Value',
}: ChartRangeBadgeProps) {
  const { mask } = usePrivacy();

  if (!result || selection.startIndex === null || selection.endIndex === null) return null;
  if (selection.startIndex === selection.endIndex) return null;

  const fmt = formatValue ?? ((v: number) => defaultFormatValue(v, unit));
  const changeLabel = formatChange(result, unit);
  const isPositive = result.changePercent !== null && result.endValue >= result.startValue;
  const changeColor =
    result.changePercent === null
      ? 'hsl(var(--muted-foreground))'
      : isPositive
        ? 'hsl(142, 71%, 45%)'
        : 'hsl(0, 72%, 51%)';

  return (
    <div className="absolute top-2 right-2 rounded-lg border border-border bg-card p-3 shadow-lg text-xs z-10 min-w-[160px]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="font-medium text-foreground">
          {result.startLabel} → {result.endLabel}
        </p>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear range selection"
          className="text-muted-foreground hover:text-foreground leading-none"
        >
          ✕
        </button>
      </div>
      <p className="text-muted-foreground">
        {valueLabel}: {mask(fmt(result.startValue))} → {mask(fmt(result.endValue))}
      </p>
      <p style={{ color: changeColor }} className="font-medium mt-0.5">
        {mask(changeLabel)}
      </p>
    </div>
  );
}
