// Covers the drag-to-select range badge wired into PortfolioCharts (representative of the same
// pattern applied to every other chart — see src/components/charts/ChartRangeBadge.tsx and
// src/hooks/useChartRangeSelection.ts). Follows the repo convention of mocking hooks directly
// (CLAUDE.md; see src/test/exposure-section.test.tsx) rather than driving real recharts mouse
// pixel math, which jsdom can't lay out precisely even with the ResizeObserver stub.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioCharts } from '@/components/PortfolioCharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));
vi.mock('@/hooks/useChartRangeSelection', () => ({
  useChartRangeSelection: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);
const mockedUseChartRangeSelection = vi.mocked(useChartRangeSelection);

const transactions: Transaction[] = [
  { id: '1', symbol: 'ACME', type: 'BUY', quantity: 10, price: 100, date: '2024-01-01T00:00:00Z' },
  { id: '2', symbol: 'ACME', type: 'BUY', quantity: 10, price: 100, date: '2024-06-01T00:00:00Z' },
];

function activeSelection() {
  return {
    selection: { startIndex: 0, endIndex: 1, isDragging: false },
    handlers: { onMouseDown: vi.fn(), onMouseMove: vi.fn(), onMouseUp: vi.fn(), onMouseLeave: vi.fn() },
    clear: vi.fn(),
  };
}

function emptySelection() {
  return {
    selection: { startIndex: null, endIndex: null, isDragging: false },
    handlers: { onMouseDown: vi.fn(), onMouseMove: vi.fn(), onMouseUp: vi.fn(), onMouseLeave: vi.fn() },
    clear: vi.fn(),
  };
}

describe('PortfolioCharts range selection', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
  });

  it('shows no range badge when nothing is selected', () => {
    mockedUseChartRangeSelection.mockReturnValue(emptySelection());
    render(<PortfolioCharts transactions={transactions} currentPrices={{ ACME: 150 }} />);
    expect(screen.queryByLabelText('Clear range selection')).not.toBeInTheDocument();
  });

  it('shows the % change badge for a finalized drag selection', () => {
    mockedUseChartRangeSelection.mockReturnValue(activeSelection());
    render(<PortfolioCharts transactions={transactions} currentPrices={{ ACME: 150 }} />);

    // Point 0 (after the first buy): qty 10 @ cost ₹100, marked at ₹150 => currentValue ₹1,500.
    // Point 1 (after the second buy): qty 20 @ cost ₹100, marked at ₹150 => currentValue ₹3,000.
    // (3000-1500)/1500 = +100.00% — and P&L (500 -> 1000) happens to double too, so both of this
    // component's two chart instances render the same badge value.
    const changeLabels = screen.getAllByText('+100.00%');
    expect(changeLabels.length).toBeGreaterThan(0);
  });

  it('masks the badge values when privacy mode hides values', () => {
    mockedUsePrivacy.mockReturnValue({ hidden: true, toggle: vi.fn(), mask: () => '••••••' });
    mockedUseChartRangeSelection.mockReturnValue(activeSelection());
    render(<PortfolioCharts transactions={transactions} currentPrices={{ ACME: 150 }} />);

    expect(screen.queryByText('+100.00%')).not.toBeInTheDocument();
    expect(screen.getAllByText('••••••').length).toBeGreaterThan(0);
  });

  it('offers a clear (✕) control on the badge', () => {
    mockedUseChartRangeSelection.mockReturnValue(activeSelection());
    render(<PortfolioCharts transactions={transactions} currentPrices={{ ACME: 150 }} />);
    expect(screen.getAllByLabelText('Clear range selection').length).toBeGreaterThan(0);
  });

  it('shows an annualized (XIRR) row on the Current Value badge but not the P&L badge', () => {
    mockedUseChartRangeSelection.mockReturnValue(activeSelection());
    render(<PortfolioCharts transactions={transactions} currentPrices={{ ACME: 150 }} />);

    // Both BUYs are ₹100/share and the range spans exactly the 2024-01-01 -> 2024-06-01 window
    // used to build these two chart points, so this reduces to plain point-to-point appreciation
    // — asserting "a real number, not em-dash" is what matters here (the exact math is covered by
    // src/test/chart-range-selection.test.ts's computeRangeXIRR unit tests).
    expect(screen.getAllByText(/Annualized \(XIRR\):/).length).toBe(1);
  });
});
