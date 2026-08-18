import { useCallback, useMemo, useState } from 'react';

/**
 * Recharts fires chart-level mouse events with a CategoricalChartState that includes
 * `activeTooltipIndex` (index into the chart's `data` array closest to the cursor) and
 * `activeLabel` (the corresponding XAxis category value). We only need the index.
 */
interface RechartsMouseState {
  activeTooltipIndex?: number | string;
  isTooltipActive?: boolean;
}

export interface RangeSelection {
  /** Index into the chart's data array where the drag started. Null when nothing is selected. */
  startIndex: number | null;
  /** Index into the chart's data array where the drag currently ends (or ended). Null when nothing is selected. */
  endIndex: number | null;
  /** True while the mouse button is held down and the user is actively dragging. */
  isDragging: boolean;
}

export interface UseChartRangeSelectionResult {
  selection: RangeSelection;
  /** Spread directly onto the recharts chart root (<AreaChart>/<LineChart>/<ComposedChart>). */
  handlers: {
    onMouseDown: (state: RechartsMouseState) => void;
    onMouseMove: (state: RechartsMouseState) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
  };
  clear: () => void;
}

function toIndex(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Drag-to-select a range of points on any recharts time-series chart. Spread `handlers` onto the
 * chart root; the resulting `selection` normalizes start/end regardless of drag direction, so
 * consumers never need to worry about which side the user started from.
 */
export function useChartRangeSelection(): UseChartRangeSelectionResult {
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((state: RechartsMouseState) => {
    const idx = toIndex(state.activeTooltipIndex);
    if (idx === null) return;
    setAnchorIndex(idx);
    setCursorIndex(idx);
    setIsDragging(true);
  }, []);

  const onMouseMove = useCallback((state: RechartsMouseState) => {
    setCursorIndex((prev) => {
      const idx = toIndex(state.activeTooltipIndex);
      return idx === null ? prev : idx;
    });
  }, []);

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onMouseLeave = useCallback(() => {
    // Cancel an in-progress drag if the cursor leaves the chart area, but leave an
    // already-finalized selection (anchor/cursor from a completed drag) visible.
    setIsDragging(false);
  }, []);

  const clear = useCallback(() => {
    setAnchorIndex(null);
    setCursorIndex(null);
    setIsDragging(false);
  }, []);

  const selection = useMemo<RangeSelection>(() => {
    if (anchorIndex === null || cursorIndex === null) {
      return { startIndex: null, endIndex: null, isDragging: false };
    }
    return {
      startIndex: Math.min(anchorIndex, cursorIndex),
      endIndex: Math.max(anchorIndex, cursorIndex),
      isDragging,
    };
  }, [anchorIndex, cursorIndex, isDragging]);

  return {
    selection,
    handlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave },
    clear,
  };
}
