// The AUM hero tile carries a decorative background graph (AumBackdrop) that
// switches between the gain and loss palette depending on totalPnl, and must
// never block reading the figures/labels rendered on top of it.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SummaryBar } from '@/components/SummaryBar';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { PortfolioSummary, Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

vi.mocked(usePrivacy).mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });

const baseSummary: PortfolioSummary = {
  investedValue: 100000,
  currentValue: 110000,
  totalPnl: 10000,
  totalPnlPercent: 10,
  liquidCash: 5000,
  vaultCash: 2000,
  pfBalance: 1000,
  creditCardDebt: 0,
  totalPortfolioValue: 118000,
  xirr: 0.12,
  xirrExPf: 0.11,
};

const transactions: Transaction[] = [];

function renderSummary(summary: PortfolioSummary) {
  render(
    <MemoryRouter>
      <SummaryBar summary={summary} transactions={transactions} />
    </MemoryRouter>,
  );
}

describe('SummaryBar AUM backdrop', () => {
  it('renders the decorative graph behind the AUM figure without hiding it', () => {
    renderSummary(baseSummary);

    expect(screen.getByText('₹1,18,000')).toBeInTheDocument();
    // AumBackdrop is aria-hidden and purely decorative — assert it exists via
    // the hero card containing an <svg>, rather than by visible text.
    const heroCard = screen.getByText('Assets Under Management (AUM)').closest('.rounded-2xl');
    expect(heroCard?.querySelector('svg')).toBeTruthy();
  });

  it('switches the backdrop palette when total P&L is negative', () => {
    renderSummary({ ...baseSummary, totalPnl: -5000, totalPnlPercent: -5 });

    const heroCard = screen.getByText('Assets Under Management (AUM)').closest('.rounded-2xl');
    const gradientStop = heroCard?.querySelector('linearGradient stop');
    expect(gradientStop?.getAttribute('stop-color')).toBe('hsl(var(--loss))');
  });
});
