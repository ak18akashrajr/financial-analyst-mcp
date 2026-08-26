// Covers the AUM target goal line added to NetWorthChart (TODO.md: "AUM target: ₹50L by March
// 2028") — the static ₹50L reference line plus the % of target hit as of today. Follows the same
// hook-mocking pattern as net-worth-chart-range.test.tsx (CLAUDE.md convention: mock hooks
// directly rather than driving real recharts mouse/pixel math).
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetWorthChart } from '@/components/NetWorthChart';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';

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

function noSelection() {
  return {
    selection: { startIndex: null, endIndex: null, isDragging: false },
    handlers: { onMouseDown: vi.fn(), onMouseMove: vi.fn(), onMouseUp: vi.fn(), onMouseLeave: vi.fn() },
    clear: vi.fn(),
  };
}

const baseProps = {
  portfolioValue: 2500000,
  liquidCash: 0,
  vaultCash: 0,
  refreshKey: 0,
};

describe('NetWorthChart — AUM goal line (₹50L by Mar 2028)', () => {
  beforeEach(() => {
    mockedUseChartRangeSelection.mockReturnValue(noSelection());
    historyRows.length = 0;
    historyRows.push(
      { recorded_at: '2025-01-01T00:00:00Z', net_worth: 2000000 },
      { recorded_at: '2026-01-01T00:00:00Z', net_worth: 2500000 },
    );
  });

  it('shows % of the ₹50L goal hit as of today', async () => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
    render(<NetWorthChart {...baseProps} currentNetWorth={2500000} />);
    // 2,500,000 / 5,000,000 = 50.0%
    await waitFor(() => expect(screen.getByText(/50\.0%/)).toBeInTheDocument());
    expect(screen.getByText(/of ₹50L goal \(Mar 2028\)/)).toBeInTheDocument();
  });

  it('masks the % figure when privacy mode hides values', async () => {
    mockedUsePrivacy.mockReturnValue({ hidden: true, toggle: vi.fn(), mask: () => '••••••' });
    render(<NetWorthChart {...baseProps} currentNetWorth={2500000} />);
    await waitFor(() => expect(screen.getByText(/of ₹50L goal \(Mar 2028\)/)).toBeInTheDocument());
    expect(screen.queryByText(/50\.0%/)).not.toBeInTheDocument();
  });
});
