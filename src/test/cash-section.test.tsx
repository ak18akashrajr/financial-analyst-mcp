// Covers CashSection's income/expense "exclude from tracking" toggle (Operating
// Cash / Cash Reserve only) and the relocated "Settle Now" liability button —
// moved from the section header into the Credit Card box itself (see TODO.md).
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashSection } from '@/components/CashSection';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { CashSettings } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);

const cash: CashSettings = { liquidCash: 10000, vaultCash: 20000, pfBalance: 5000, creditCardDebt: 1500 };

/** The bordered card wrapping a labeled field — both CashCard and DebtCard use `rounded-2xl`. */
function cardFor(labelText: string): HTMLElement {
  return screen.getByText(labelText).closest('.rounded-2xl') as HTMLElement;
}

describe('CashSection', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
  });

  it('no longer shows a "Liability Settlement" button in the section header', () => {
    render(<CashSection cash={cash} onUpdate={vi.fn()} onPayCreditCard={vi.fn()} />);
    expect(screen.queryByText('Liability Settlement')).not.toBeInTheDocument();
  });

  it('shows "Settle Now" on the Credit Card box when there is outstanding debt', () => {
    const onPayCreditCard = vi.fn();
    render(<CashSection cash={cash} onUpdate={vi.fn()} onPayCreditCard={onPayCreditCard} />);
    const button = screen.getByText('Settle Now');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onPayCreditCard).toHaveBeenCalledTimes(1);
  });

  it("disables \"Settle Now\" when Cash Reserve can't cover the outstanding debt", () => {
    const shortOnCash: CashSettings = { ...cash, vaultCash: 1000, creditCardDebt: 1500 };
    render(<CashSection cash={shortOnCash} onUpdate={vi.fn()} onPayCreditCard={vi.fn()} />);
    expect(screen.getByText('Settle Now').closest('button')).toBeDisabled();
  });

  it('hides "Settle Now" once there is no outstanding debt', () => {
    render(<CashSection cash={{ ...cash, creditCardDebt: 0 }} onUpdate={vi.fn()} onPayCreditCard={vi.fn()} />);
    expect(screen.queryByText('Settle Now')).not.toBeInTheDocument();
  });

  it('shows the exclude-from-tracking checkbox when editing Operating Cash, and passes it through on save', () => {
    const onUpdate = vi.fn();
    render(<CashSection cash={cash} onUpdate={onUpdate} />);

    const card = cardFor('Operating Cash');
    fireEvent.click(within(card).getByRole('button')); // pencil → edit mode

    const checkbox = within(card).getByLabelText(/exclude from income\/expense/i);
    fireEvent.click(checkbox);

    fireEvent.change(within(card).getByRole('spinbutton'), { target: { value: '12000' } });
    fireEvent.click(within(card).getByRole('button')); // Check → save

    expect(onUpdate).toHaveBeenCalledWith({ liquidCash: 12000 }, { excludeFromCashflow: true });
  });

  it('defaults the exclude toggle to unchecked (counted as income/expense) when left alone', () => {
    const onUpdate = vi.fn();
    render(<CashSection cash={cash} onUpdate={onUpdate} />);

    const card = cardFor('Cash Reserve');
    fireEvent.click(within(card).getByRole('button'));
    fireEvent.change(within(card).getByRole('spinbutton'), { target: { value: '15000' } });
    fireEvent.click(within(card).getByRole('button'));

    expect(onUpdate).toHaveBeenCalledWith({ vaultCash: 15000 }, { excludeFromCashflow: false });
  });

  it('does not show the exclude-from-tracking checkbox when editing the PF Account', () => {
    render(<CashSection cash={cash} onUpdate={vi.fn()} />);
    const card = cardFor('PF Account');
    fireEvent.click(within(card).getByRole('button'));
    expect(within(card).queryByLabelText(/exclude from income\/expense/i)).not.toBeInTheDocument();
  });

  it('does not pass exclude options when editing the Credit Card box', () => {
    const onUpdate = vi.fn();
    render(<CashSection cash={cash} onUpdate={onUpdate} onPayCreditCard={vi.fn()} />);

    const card = cardFor('Outstanding Liabilities');
    fireEvent.click(within(card).getByText('Edit'));
    fireEvent.change(within(card).getByRole('spinbutton'), { target: { value: '800' } });
    fireEvent.click(within(card).getByRole('button'));

    expect(onUpdate).toHaveBeenCalledWith({ creditCardDebt: 800 }, undefined);
  });
});
