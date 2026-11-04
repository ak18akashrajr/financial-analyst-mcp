// Hovering a day in the Daily Movement heatmap must show exact per-symbol price movement; the monthly
// summary must show the green/red/grey counts of active trading days.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyMovementHeatmap } from '@/components/DailyMovementHeatmap';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: vi.fn() }));

const PRICES = [
  { symbol: 'AAA', date: '2026-10-26', close: 100 },
  { symbol: 'AAA', date: '2026-10-27', close: 110 },
  { symbol: 'AAA', date: '2026-10-28', close: 99 },
  { symbol: 'AAA', date: '2026-10-29', close: 99.01 },
];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        in: () => q,
        order: () => q,
        range: () => Promise.resolve({ data: PRICES, error: null }),
      };
      return q;
    },
  },
}));

const TXNS: Transaction[] = [
  { id: '1', symbol: 'AAA', type: 'BUY', quantity: 10, price: 100, date: '2026-10-26T04:00:00Z' },
];

describe('DailyMovementHeatmap', () => {
  beforeEach(() => {
    vi.mocked(usePrivacy).mockReturnValue({ hidden: false, toggle: vi.fn() } as unknown as ReturnType<typeof usePrivacy>);
  });

  it('shows the exact price movement for a day on hover', async () => {
    render(<DailyMovementHeatmap transactions={TXNS} />);
    const cell = await screen.findByRole('button', { name: /Daily movement for .*27 Oct,? 2026/ });
    fireEvent.pointerEnter(cell, { pointerType: 'mouse' });
    fireEvent.pointerMove(cell, { pointerType: 'mouse' });
    expect(await screen.findByText('100 → 110')).toBeInTheDocument();
    expect(screen.getAllByText('+₹100').length).toBeGreaterThan(0);
    expect(screen.getByText('+10.00%', { selector: 'div' })).toBeInTheDocument();
  });

  it('summarises the month as active days split into green / red / grey', async () => {
    render(<DailyMovementHeatmap transactions={TXNS} />);
    // Collapsed by default; expand the toggle first.
    const toggle = await screen.findByRole('button', { name: /Monthly summary/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Day counts for Oct/ })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const month = await screen.findByRole('button', { name: /Day counts for Oct FY26-27/ });
    // 27 Oct green (+10%), 28 Oct red (−10%), 29 Oct grey (+0.01%)
    expect(month).toHaveTextContent('1·1·1');
  });

  it('states the FY profit rate and a net profit/loss, with ₹ masked when hidden', async () => {
    render(<DailyMovementHeatmap transactions={TXNS} />);
    // 3 active days: 1 profitable → 33.3%; P&L = +100 −110 +0.1 = −9.9 → loss
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('FY26-27 so far: 1 of 3 active trading days closed profitable (33.3% profit rate)');
    expect(stmt).toHaveTextContent('net loss −₹10');
  });

  it('hides the FY ₹ figure when numbers are hidden', async () => {
    vi.mocked(usePrivacy).mockReturnValue({ hidden: true, toggle: vi.fn() } as unknown as ReturnType<typeof usePrivacy>);
    render(<DailyMovementHeatmap transactions={TXNS} />);
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).not.toHaveTextContent('₹');
  });

  it('masks ₹ amounts when numbers are hidden', async () => {
    vi.mocked(usePrivacy).mockReturnValue({ hidden: true, toggle: vi.fn() } as unknown as ReturnType<typeof usePrivacy>);
    render(<DailyMovementHeatmap transactions={TXNS} />);
    const cell = await screen.findByRole('button', { name: /Daily movement for .*27 Oct,? 2026/ });
    fireEvent.pointerEnter(cell, { pointerType: 'mouse' });
    fireEvent.pointerMove(cell, { pointerType: 'mouse' });
    await screen.findByText(/What moved/);
    expect(screen.queryByText('+₹100')).not.toBeInTheDocument();
  });
});
