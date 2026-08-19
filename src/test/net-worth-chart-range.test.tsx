// Covers the drag-to-select range badge on NetWorthChart, specifically the annualized (XIRR) row
// added by feature-ideas.md #6 — see src/test/portfolio-charts-range.test.tsx for the same pattern
// applied to PortfolioCharts, and src/test/chart-range-selection.test.ts for computeRangeXIRR's
// own unit tests. Mocks the hooks + Supabase client directly (CLAUDE.md convention) rather than
// driving a real fetch or real recharts mouse pixel math.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetWorthChart } from '@/components/NetWorthChart';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));
vi.mock('@/hooks/useChartRangeSelection', () => ({
  useChartRangeSelection: vi.fn(),
}));

const { historyRows } = vi.hoisted(() => ({
  historyRows: [] as { recorded_at: string; net_worth: number }[],
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: historyRows, error: null }),
      }),
    }),
  },
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);
const mockedUseChartRangeSelection = vi.mocked(useChartRangeSelection);

const transactions: Transaction[] = [
  { id: '1', symbol: 'ACME', type: 'BUY', quantity: 10, price: 10000, date: '2025-01-01T00:00:00Z' },
];

function activeSelection() {
  return {
    selection: { startIndex: 0, endIndex: 1, isDragging: false },
    handlers: { onMouseDown: vi.fn(), onMouseMove: vi.fn(), onMouseUp: vi.fn(), onMouseLeave: vi.fn() },
    clear: vi.fn(),
  };
}

const baseProps = {
  currentNetWorth: 110000,
  portfolioValue: 110000,
  liquidCash: 0,
  vaultCash: 0,
  refreshKey: 0,
};

describe('NetWorthChart range selection — annualized XIRR', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
    mockedUseChartRangeSelection.mockReturnValue(activeSelection());
    historyRows.length = 0;
    historyRows.push(
      { recorded_at: '2025-01-01T00:00:00Z', net_worth: 100000 },
      { recorded_at: '2026-01-01T00:00:00Z', net_worth: 110000 },
    );
  });

  it('shows the annualized (XIRR) row when transactions are supplied', async () => {
    render(<NetWorthChart {...baseProps} transactions={transactions} />);
    await waitFor(() => expect(screen.getByText(/Annualized \(XIRR\):/)).toBeInTheDocument());
  });

  it('omits the annualized (XIRR) row entirely when no transactions prop is passed', async () => {
    render(<NetWorthChart {...baseProps} />);
    await waitFor(() => expect(screen.getByLabelText('Clear range selection')).toBeInTheDocument());
    expect(screen.queryByText(/Annualized \(XIRR\):/)).not.toBeInTheDocument();
  });

  it('masks the XIRR figure when privacy mode hides values', async () => {
    mockedUsePrivacy.mockReturnValue({ hidden: true, toggle: vi.fn(), mask: () => '••••••' });
    render(<NetWorthChart {...baseProps} transactions={transactions} />);
    await waitFor(() => expect(screen.getByText(/Annualized \(XIRR\):/)).toBeInTheDocument());
    expect(screen.getByText(/Annualized \(XIRR\): ••••••/)).toBeInTheDocument();
  });
});
