// Covers the performance-attribution bar chart: empty state, and that it
// renders a bar per holding using contribution-to-total-return (not each
// holding's own return %) — see performance-attribution.test.ts for the
// underlying computation's own coverage.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceAttribution } from '@/components/PerformanceAttribution';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DerivedHolding } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);

function makeHolding(overrides: Partial<DerivedHolding>): DerivedHolding {
  return {
    symbol: 'TCS',
    totalQuantity: 10,
    totalInvested: 100000,
    avgPrice: 10000,
    currentPrice: 11000,
    currentValue: 110000,
    pnl: 10000,
    pnlPercent: 10,
    transactions: [],
    ...overrides,
  };
}

describe('PerformanceAttribution', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
  });

  it('shows empty-state copy when there are no holdings', () => {
    render(<PerformanceAttribution holdings={[]} />);
    expect(screen.getByText(/see what's driving your returns/i)).toBeInTheDocument();
  });

  it('renders a legend row per current holding, labeled by symbol with its contribution', () => {
    const holdings = [
      makeHolding({ symbol: 'TCS', totalInvested: 100000, pnl: 20000 }),
      makeHolding({ symbol: 'HDFC', totalInvested: 300000, pnl: -30000 }),
    ];
    render(<PerformanceAttribution holdings={holdings} />);
    // Scoped to the legend list — recharts' chart SVG renders in jsdom too,
    // sometimes non-deterministically duplicating tick text, so assert
    // against the plain-DOM legend rather than the whole document.
    const legend = within(screen.getByTestId('attribution-legend'));
    expect(legend.getByText('TCS')).toBeInTheDocument();
    expect(legend.getByText('HDFC')).toBeInTheDocument();
    expect(legend.getByText(/\+5\.00%/)).toBeInTheDocument(); // TCS: 20000/400000
    expect(legend.getByText(/-7\.50%/)).toBeInTheDocument(); // HDFC: -30000/400000
  });

  it('does not render an empty-state when total invested is zero (falls back gracefully)', () => {
    const holdings = [makeHolding({ symbol: 'TCS', totalInvested: 0, pnl: 0 })];
    render(<PerformanceAttribution holdings={holdings} />);
    expect(screen.getByText(/see what's driving your returns/i)).toBeInTheDocument();
  });
});
