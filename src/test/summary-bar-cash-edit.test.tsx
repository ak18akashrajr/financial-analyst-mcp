// Covers the cash-editing behavior moved into SummaryBar's top boxes (Operating
// Cash / Cash Reserve / PF / Outstanding Liabilities) after the old, separate
// Cash Management section (CashSection.tsx) was removed — same "exclude from
// tracking" toggle and "Settle Now" liability semantics, just relocated.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SummaryBar } from '@/components/SummaryBar';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { PortfolioSummary, Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

// SummaryBar renders XirrDetailsCard, which imports the real Supabase client
// at module load — see summary-bar-aum-backdrop.test.tsx for why this is mocked.
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

vi.mocked(usePrivacy).mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });

const baseSummary: PortfolioSummary = {
  investedValue: 100000,
  currentValue: 110000,
  totalPnl: 10000,
  totalPnlPercent: 10,
  liquidCash: 10000,
  vaultCash: 20000,
  pfBalance: 5000,
  creditCardDebt: 1500,
  totalPortfolioValue: 133500,
  xirr: 0.12,
  xirrExPf: 0.11,
};

const transactions: Transaction[] = [];

/** The bordered box wrapping a labeled cash field. */
function boxFor(labelText: string): HTMLElement {
  return screen.getByText(labelText).closest('.rounded-xl') as HTMLElement;
}

function renderSummary(summary: PortfolioSummary, onUpdateCash = vi.fn(), onPayCreditCard = vi.fn()) {
  render(
    <MemoryRouter>
      <SummaryBar
        summary={summary}
        transactions={transactions}
        onUpdateCash={onUpdateCash}
        onPayCreditCard={onPayCreditCard}
      />
    </MemoryRouter>,
  );
}

describe('SummaryBar cash editing', () => {
  it('has no separate Cash Management section', () => {
    renderSummary(baseSummary);
    expect(screen.queryByText('Cash Management')).not.toBeInTheDocument();
  });

  it('shows "Settle Now" on the Outstanding Liabilities box when there is debt', () => {
    const onPayCreditCard = vi.fn();
    renderSummary(baseSummary, vi.fn(), onPayCreditCard);
    const button = screen.getByText('Settle Now');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onPayCreditCard).toHaveBeenCalledTimes(1);
  });

  it("disables \"Settle Now\" when Cash Reserve can't cover the outstanding debt", () => {
    renderSummary({ ...baseSummary, vaultCash: 1000, creditCardDebt: 1500 });
    expect(screen.getByText('Settle Now').closest('button')).toBeDisabled();
  });

  it('hides "Settle Now" once there is no outstanding debt', () => {
    renderSummary({ ...baseSummary, creditCardDebt: 0 });
    expect(screen.queryByText('Settle Now')).not.toBeInTheDocument();
  });

  it('shows the exclude-from-tracking checkbox when editing Operating Cash, and passes it through on save', () => {
    const onUpdateCash = vi.fn();
    renderSummary(baseSummary, onUpdateCash);

    const box = boxFor('Operating Cash');
    fireEvent.click(within(box).getByRole('button')); // pencil → edit mode

    const checkbox = within(box).getByLabelText(/exclude from income\/expense/i);
    fireEvent.click(checkbox);

    fireEvent.change(within(box).getByRole('spinbutton'), { target: { value: '12000' } });
    fireEvent.click(within(box).getByRole('button')); // Check → save

    expect(onUpdateCash).toHaveBeenCalledWith({ liquidCash: 12000 }, { excludeFromCashflow: true });
  });

  it('defaults the exclude toggle to unchecked (counted as income/expense) when left alone', () => {
    const onUpdateCash = vi.fn();
    renderSummary(baseSummary, onUpdateCash);

    const box = boxFor('Cash Reserve');
    fireEvent.click(within(box).getByRole('button'));
    fireEvent.change(within(box).getByRole('spinbutton'), { target: { value: '15000' } });
    fireEvent.click(within(box).getByRole('button'));

    expect(onUpdateCash).toHaveBeenCalledWith({ vaultCash: 15000 }, { excludeFromCashflow: false });
  });

  it('does not show the exclude-from-tracking checkbox when editing the PF box', () => {
    renderSummary(baseSummary);
    const box = boxFor('PF (PPF/EPF)');
    fireEvent.click(within(box).getByRole('button'));
    expect(within(box).queryByLabelText(/exclude from income\/expense/i)).not.toBeInTheDocument();
  });

  it('does not pass exclude options when editing the Outstanding Liabilities box', () => {
    const onUpdateCash = vi.fn();
    renderSummary(baseSummary, onUpdateCash);

    const box = boxFor('Outstanding Liabilities');
    // At rest with outstanding debt, the box shows both the edit pencil and
    // "Settle Now" — the pencil renders first.
    fireEvent.click(within(box).getAllByRole('button')[0]); // pencil → edit mode
    fireEvent.change(within(box).getByRole('spinbutton'), { target: { value: '800' } });
    fireEvent.click(within(box).getByRole('button')); // only the save Check button remains while editing

    expect(onUpdateCash).toHaveBeenCalledWith({ creditCardDebt: 800 }, undefined);
  });

  it('does not show an edit pencil on the derived Principal Capital Allocated box', () => {
    renderSummary(baseSummary);
    const box = boxFor('Principal Capital Allocated');
    expect(within(box).queryByRole('button')).not.toBeInTheDocument();
  });
});
