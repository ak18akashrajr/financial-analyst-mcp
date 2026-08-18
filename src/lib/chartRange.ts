/**
 * Point-to-point return between two points a user has drag-selected on any time-series chart.
 * Deliberately generic: it works on any numeric field of any chart's data array, so the same
 * function backs the AUM chart, the rolling-XIRR chart, the FX-rate chart, and every projection
 * chart alike (see docs/plan for the "simple % change" decision — no cash-flow/XIRR math here).
 */
export interface RangeReturnResult {
  startValue: number;
  endValue: number;
  startLabel: string;
  endLabel: string;
  /** (endValue - startValue) / startValue, as a fraction (0.05 = +5%). Null when not computable. */
  changePercent: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function toLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Computes the return between `data[startIndex][valueKey]` and `data[endIndex][valueKey]`.
 * Returns null for `changePercent` (rather than throwing) when either point's value is missing/
 * non-numeric (e.g. a rolling-XIRR series has `xirr: number | null` before enough history exists)
 * or when `startValue` is 0 (division by zero) — callers should render "—" in that case.
 */
export function computeRangeReturn<T>(
  data: ReadonlyArray<T>,
  startIndex: number,
  endIndex: number,
  valueKey: keyof T,
  labelKey: keyof T
): RangeReturnResult | null {
  if (startIndex < 0 || endIndex < 0 || startIndex >= data.length || endIndex >= data.length) {
    return null;
  }

  const startPoint = data[startIndex];
  const endPoint = data[endIndex];
  const startValue = toFiniteNumber(startPoint[valueKey]);
  const endValue = toFiniteNumber(endPoint[valueKey]);
  const startLabel = toLabel(startPoint[labelKey]);
  const endLabel = toLabel(endPoint[labelKey]);

  if (startValue === null || endValue === null) {
    return { startValue: startValue ?? 0, endValue: endValue ?? 0, startLabel, endLabel, changePercent: null };
  }

  const changePercent = startValue === 0 ? null : (endValue - startValue) / startValue;

  return { startValue, endValue, startLabel, endLabel, changePercent };
}
