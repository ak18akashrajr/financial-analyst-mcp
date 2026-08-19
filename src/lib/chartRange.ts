import { calculateXIRR } from './xirr';
import type { Transaction } from '@/types/portfolio';

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

/**
 * Annualized (XIRR) return for a drag-selected range on a cash-flow-backed chart — the v2
 * deferred from the point-to-point badge (see docs/feature-ideas.md #6). Unlike
 * `computeRangeReturn`, this needs the underlying transaction history, not just the two chart
 * points: it treats the chart's own value at `startIndex` as if it were bought outright on that
 * date (an outflow), folds in any real BUY/SELL transactions that happened strictly between the
 * two dates, and treats the chart's value at `endIndex` as the terminal inflow — then feeds all of
 * that through the same Newton-Raphson `calculateXIRR` the rest of the app uses.
 *
 * Returns `null` (never throws) when the range can't produce a sane XIRR: out-of-bounds indices,
 * a non-numeric/negative boundary value, a zero-length window, or a cash-flow set XIRR can't
 * converge on (e.g. no sign change).
 */
export function computeRangeXIRR<T>(
  data: ReadonlyArray<T>,
  startIndex: number,
  endIndex: number,
  valueKey: keyof T,
  dateKey: keyof T,
  transactions: ReadonlyArray<Transaction>
): number | null {
  if (startIndex < 0 || endIndex < 0 || startIndex >= data.length || endIndex >= data.length) {
    return null;
  }
  if (startIndex === endIndex) return null;

  const startPoint = data[startIndex];
  const endPoint = data[endIndex];
  const startValue = toFiniteNumber(startPoint[valueKey]);
  const endValue = toFiniteNumber(endPoint[valueKey]);
  if (startValue === null || endValue === null || startValue <= 0) return null;

  const startDate = new Date(startPoint[dateKey] as unknown as string);
  const endDate = new Date(endPoint[dateKey] as unknown as string);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate.getTime() <= startDate.getTime()) return null;

  const cashFlows = [
    { amount: -startValue, date: startDate },
    ...transactions
      .filter(t => {
        const d = new Date(t.date);
        return d > startDate && d <= endDate;
      })
      .map(t => ({
        amount: t.type === 'BUY' ? -(t.quantity * t.price) : t.quantity * t.price,
        date: new Date(t.date),
      })),
    { amount: endValue, date: endDate },
  ];

  const rate = calculateXIRR(cashFlows);
  return rate === null ? null : rate * 100;
}
