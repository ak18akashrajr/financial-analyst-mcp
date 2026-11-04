// Hovering a day in the Daily Movement heatmap must show exact per-symbol price movement; the monthly
// summary must show the green/red/grey counts of active trading days.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyMovementHeatmap } from '@/components/DailyMovementHeatmap';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: vi.fn() }));

const mk = (...closes: [string, number][]) => closes.map(([date, close]) => ({ symbol: 'AAA', date, close }));
const DEFAULT_PRICES = mk(['2026-10-26', 100], ['2026-10-27', 110], ['2026-10-28', 99], ['2026-10-29', 99.01]);
const state = vi.hoisted(() => ({ prices: [] as { symbol: string; date: string; close: number }[] }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        in: () => q,
        order: () => q,
        range: () => Promise.resolve({ data: state.prices, error: null }),
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
    state.prices = DEFAULT_PRICES;
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

  it('minority of days profitable and a net loss: "Only … net loss"', async () => {
    render(<DailyMovementHeatmap transactions={TXNS} />);
    // 3 active days: 1 profitable → 33.3%; P&L = +100 −110 +0.1 = −9.9
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('Only 1 of 3 active trading days (33.3%) were profitable in FY26-27 so far, with a net loss of ₹10.');
  });

  it('majority of days profitable but a net loss: "Even though …"', async () => {
    state.prices = mk(['2026-10-26', 100], ['2026-10-27', 101], ['2026-10-28', 102], ['2026-10-29', 80]);
    render(<DailyMovementHeatmap transactions={TXNS} />);
    // green, green, red(−22/share ×10) → 66.7%, P&L = 10 + 10 − 220 = −200
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('Even though 2 of 3 active trading days (66.7%) were profitable, FY26-27 so far ended with a net loss of ₹200.');
  });

  it('minority of days profitable but a net profit: "Although only …"', async () => {
    state.prices = mk(['2026-10-26', 100], ['2026-10-27', 99], ['2026-10-28', 98], ['2026-10-29', 120]);
    render(<DailyMovementHeatmap transactions={TXNS} />);
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('Although only 1 of 3 active trading days (33.3%) were profitable, FY26-27 so far ended with a net profit of ₹200.');
  });

  it('majority profitable and a net profit reads plainly', async () => {
    state.prices = mk(['2026-10-26', 100], ['2026-10-27', 101], ['2026-10-28', 102]);
    render(<DailyMovementHeatmap transactions={TXNS} />);
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('2 of 2 active trading days (100.0%) were profitable in FY26-27 so far, with a net profit of ₹20.');
  });

  it('shows the in-progress YTD disclaimer for the current FY and drops it once the FY has ended', async () => {
    const { unmount } = render(<DailyMovementHeatmap transactions={TXNS} />);
    expect(await screen.findByTestId('fy-in-progress')).toHaveTextContent('FY26-27 is still in progress — figures are as of YTD.');
    unmount();

    state.prices = mk(['2025-10-27', 100], ['2025-10-28', 101]);
    render(<DailyMovementHeatmap transactions={[{ ...TXNS[0], date: '2025-10-27T04:00:00Z' }]} />);
    const stmt = await screen.findByTestId('fy-statement');
    expect(stmt).toHaveTextContent('1 of 1 active trading days (100.0%) were profitable in FY25-26, with a net profit of ₹10.');
    expect(screen.queryByTestId('fy-in-progress')).not.toBeInTheDocument();
    expect(stmt).not.toHaveTextContent('so far');
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
