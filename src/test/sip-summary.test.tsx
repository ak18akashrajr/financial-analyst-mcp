// Covers the Dashboard's SIP/Investment Activity card: the YoY nudge on the
// FY table's Total Principal Allocated column (compared on avg/month, not
// raw totals, since the current FY is partial) and the hover-only
// motivational tooltip on the progress bar once the monthly target is hit.
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIPSummary } from '@/components/SIPSummary';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);

function buy(date: string, quantity: number, price: number): Transaction {
  return { id: date, date, type: 'BUY', quantity, price } as Transaction;
}

function renderSummary(transactions: Transaction[]) {
  return render(
    <TooltipProvider>
      <SIPSummary transactions={transactions} />
    </TooltipProvider>
  );
}

describe('SIPSummary', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-06-15'));
  });

  it('shows an up nudge when this FY avg/month exceeds last FY avg/month', () => {
    renderSummary([
      // FY 2024-25 (Apr 2024 - Mar 2025): 2 months, avg 10,000/month
      buy('2024-04-10', 1, 10000),
      buy('2024-05-10', 1, 10000),
      // FY 2025-26 (Apr 2025 onward): 1 month so far, avg 20,000/month
      buy('2025-04-10', 1, 20000),
    ]);

    const row2526 = screen.getByText('FY 2025-26').closest('tr')!;
    expect(row2526).toHaveTextContent('100%');
  });

  it('shows a down nudge when this FY avg/month is below last FY avg/month', () => {
    renderSummary([
      buy('2024-04-10', 1, 20000),
      buy('2025-04-10', 1, 10000),
    ]);

    const row2526 = screen.getByText('FY 2025-26').closest('tr')!;
    expect(row2526).toHaveTextContent('50%');
  });

  it('shows no nudge for the earliest FY with nothing to compare against', () => {
    renderSummary([buy('2024-04-10', 1, 10000)]);
    const row = screen.getByText('FY 2024-25').closest('tr')!;
    expect(row).not.toHaveTextContent('%');
  });

  it('reveals a motivational tooltip only on hover once target is hit, not as a static banner', async () => {
    localStorage.setItem('sip_monthly_target', '5000');
    const { container } = renderSummary([buy('2025-06-10', 1, 6000)]);

    // No longer shown as an always-visible banner.
    expect(screen.queryByText(/mapla!/i)).not.toBeInTheDocument();
    expect(container.querySelector('.cursor-help')).toBeInTheDocument();

    const trigger = container.querySelector('.cursor-help')!;
    fireEvent.pointerMove(trigger);
    fireEvent.pointerEnter(trigger);

    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
