// Unit tests for the drag-to-select range primitives shared by every chart:
// useChartRangeSelection (the drag state machine) and computeRangeReturn (the pure % change
// calculation it feeds into). See src/hooks/useChartRangeSelection.ts and src/lib/chartRange.ts.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn, computeRangeXIRR } from '@/lib/chartRange';
import type { Transaction } from '@/types/portfolio';

describe('useChartRangeSelection', () => {
  it('starts with no selection', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    expect(result.current.selection).toEqual({ startIndex: null, endIndex: null, isDragging: false });
  });

  it('tracks a left-to-right drag', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    act(() => result.current.handlers.onMouseDown({ activeTooltipIndex: 2 }));
    act(() => result.current.handlers.onMouseMove({ activeTooltipIndex: 5 }));
    expect(result.current.selection).toEqual({ startIndex: 2, endIndex: 5, isDragging: true });

    act(() => result.current.handlers.onMouseUp());
    expect(result.current.selection).toEqual({ startIndex: 2, endIndex: 5, isDragging: false });
  });

  it('normalizes a right-to-left drag so startIndex <= endIndex', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    act(() => result.current.handlers.onMouseDown({ activeTooltipIndex: 7 }));
    act(() => result.current.handlers.onMouseMove({ activeTooltipIndex: 1 }));
    expect(result.current.selection.startIndex).toBe(1);
    expect(result.current.selection.endIndex).toBe(7);
  });

  it('cancels an in-progress drag on mouse leave but keeps a finalized selection', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    act(() => result.current.handlers.onMouseDown({ activeTooltipIndex: 0 }));
    act(() => result.current.handlers.onMouseMove({ activeTooltipIndex: 3 }));
    act(() => result.current.handlers.onMouseUp());
    expect(result.current.selection).toEqual({ startIndex: 0, endIndex: 3, isDragging: false });

    // Leaving the chart after the drag is already finalized must not clear the range.
    act(() => result.current.handlers.onMouseLeave());
    expect(result.current.selection).toEqual({ startIndex: 0, endIndex: 3, isDragging: false });
  });

  it('clear() resets the selection', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    act(() => result.current.handlers.onMouseDown({ activeTooltipIndex: 0 }));
    act(() => result.current.handlers.onMouseMove({ activeTooltipIndex: 3 }));
    act(() => result.current.clear());
    expect(result.current.selection).toEqual({ startIndex: null, endIndex: null, isDragging: false });
  });

  it('ignores a mouse-move with no active index', () => {
    const { result } = renderHook(() => useChartRangeSelection());
    act(() => result.current.handlers.onMouseDown({ activeTooltipIndex: 2 }));
    act(() => result.current.handlers.onMouseMove({}));
    expect(result.current.selection.endIndex).toBe(2);
  });
});

describe('computeRangeReturn', () => {
  const data = [
    { label: 'Jan', value: 100 },
    { label: 'Feb', value: 110 },
    { label: 'Mar', value: 90 },
    { label: 'Apr', value: null as number | null },
    { label: 'May', value: 0 },
  ];

  it('computes a positive % change between two indices', () => {
    const r = computeRangeReturn(data, 0, 1, 'value', 'label');
    expect(r).not.toBeNull();
    expect(r!.startValue).toBe(100);
    expect(r!.endValue).toBe(110);
    expect(r!.startLabel).toBe('Jan');
    expect(r!.endLabel).toBe('Feb');
    expect(r!.changePercent).toBeCloseTo(0.1);
  });

  it('computes a negative % change', () => {
    const r = computeRangeReturn(data, 0, 2, 'value', 'label');
    expect(r!.changePercent).toBeCloseTo(-0.1);
  });

  it('returns changePercent: null when a point value is missing/non-numeric', () => {
    const r = computeRangeReturn(data, 0, 3, 'value', 'label');
    expect(r).not.toBeNull();
    expect(r!.changePercent).toBeNull();
  });

  it('returns changePercent: null (not Infinity/NaN) when startValue is 0', () => {
    const r = computeRangeReturn(data, 4, 1, 'value', 'label');
    expect(r!.changePercent).toBeNull();
  });

  it('returns null for an out-of-range index', () => {
    expect(computeRangeReturn(data, -1, 1, 'value', 'label')).toBeNull();
    expect(computeRangeReturn(data, 0, 10, 'value', 'label')).toBeNull();
  });
});

describe('computeRangeXIRR', () => {
  const points = [
    { date: '2025-01-01T00:00:00Z', label: 'Jan25', value: 100000 },
    { date: '2025-07-01T00:00:00Z', label: 'Jul25', value: 104000 },
    { date: '2026-01-01T00:00:00Z', label: 'Jan26', value: 110000 },
  ];

  it('annualizes pure appreciation between the two boundary points with no transactions', () => {
    const rate = computeRangeXIRR(points, 0, 2, 'value', 'date', []);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(10, 0); // ~10% growth over ~1 year
  });

  it('folds in a BUY transaction inside the window, diluting the annualized reading', () => {
    const transactions: Transaction[] = [
      { id: '1', symbol: 'ACME', type: 'BUY', quantity: 10, price: 500, date: '2025-07-01T00:00:00Z' },
    ];
    const withoutTxn = computeRangeXIRR(points, 0, 2, 'value', 'date', []);
    const withTxn = computeRangeXIRR(points, 0, 2, 'value', 'date', transactions);
    expect(withTxn).not.toBeNull();
    // Same start/end values, but extra principal went in mid-window — the money-weighted
    // (annualized) return must be lower than treating the whole gain as pure appreciation.
    expect(withTxn!).toBeLessThan(withoutTxn!);
  });

  it('ignores transactions dated outside the selected window', () => {
    const transactions: Transaction[] = [
      { id: '1', symbol: 'ACME', type: 'BUY', quantity: 10, price: 500, date: '2024-01-01T00:00:00Z' },
      { id: '2', symbol: 'ACME', type: 'SELL', quantity: 10, price: 500, date: '2026-06-01T00:00:00Z' },
    ];
    const withoutTxn = computeRangeXIRR(points, 0, 2, 'value', 'date', []);
    const withOutOfRangeTxn = computeRangeXIRR(points, 0, 2, 'value', 'date', transactions);
    expect(withOutOfRangeTxn).toBeCloseTo(withoutTxn!, 5);
  });

  it('returns null when startIndex === endIndex', () => {
    expect(computeRangeXIRR(points, 1, 1, 'value', 'date', [])).toBeNull();
  });

  it('returns null for out-of-range indices', () => {
    expect(computeRangeXIRR(points, -1, 2, 'value', 'date', [])).toBeNull();
    expect(computeRangeXIRR(points, 0, 10, 'value', 'date', [])).toBeNull();
  });

  it('returns null when the start value is zero or negative', () => {
    const zeroStart = [
      { date: '2025-01-01T00:00:00Z', value: 0 },
      { date: '2026-01-01T00:00:00Z', value: 110000 },
    ];
    expect(computeRangeXIRR(zeroStart, 0, 1, 'value', 'date', [])).toBeNull();
  });

  it('returns null when a boundary value is missing/non-numeric', () => {
    const withGap = [
      { date: '2025-01-01T00:00:00Z', value: null as number | null },
      { date: '2026-01-01T00:00:00Z', value: 110000 },
    ];
    expect(computeRangeXIRR(withGap, 0, 1, 'value', 'date', [])).toBeNull();
  });
});
