// Covers the dashboard XIRR breakdown popover (src/components/XirrDetailsCard.tsx): the
// Overall/ex-PF rows always shown, and the on-screen caveat distinguishing this whole-history
// cash-flow-replay XIRR from the /benchmark page's windowed simple return (added to close
// TODO.md's "Reconcile dashboard XIRR-breakdown benchmark numbers" item — see
// docs/xirr-breakdown.md). Mocks supabase directly per the repo's stated test convention
// (CLAUDE.md) rather than driving a real client.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { XirrDetailsCard } from '@/components/XirrDetailsCard';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

function renderCard(transactions: Transaction[] = [], overallXirr = 0.0772, portfolioXirr = 0.0772) {
  return render(
    <MemoryRouter>
      <XirrDetailsCard overallXirr={overallXirr} portfolioXirr={portfolioXirr} transactions={transactions} />
    </MemoryRouter>,
  );
}

describe('XirrDetailsCard', () => {
  it('shows the Overall and ex-PF XIRR rows once opened', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /xirr/i }));

    expect(screen.getByText('Overall Portfolio XIRR')).toBeInTheDocument();
    expect(screen.getByText('Portfolio XIRR (ex-PF holdings)')).toBeInTheDocument();
    expect(screen.getAllByText('+7.72%').length).toBeGreaterThan(0);
  });

  it('shows time-to-double next to a positive XIRR figure', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /xirr/i }));

    // 7.72% annualized -> ln(2)/ln(1.0772) ≈ 9.33 years, shown next to both rows.
    expect(screen.getAllByText('9.3y to double').length).toBe(2);
  });

  it('shows "—" for time-to-double when XIRR is null or non-positive', () => {
    renderCard([], null, -0.02);
    fireEvent.click(screen.getByRole('button', { name: /xirr/i }));

    // Overall (null) and ex-PF (-2%) both never double.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('states that this is a whole-history cash-flow XIRR, distinct from the /benchmark page, with a link there', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /xirr/i }));

    expect(screen.getByText(/whole-history xirr/i)).toBeInTheDocument();
    expect(screen.getByText(/different question/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /benchmark page/i });
    expect(link).toHaveAttribute('href', '/benchmark');
  });
});
