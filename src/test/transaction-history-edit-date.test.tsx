// Covers editing a transaction's date in src/components/TransactionHistory.tsx — added
// alongside the quantity/price edit fields so a mis-dated transaction can be corrected
// without deleting and re-adding it.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionHistory } from '@/components/TransactionHistory';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ mask: (v: string) => v, hidden: false, toggle: vi.fn() }),
}));

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    symbol: 'TCS',
    type: 'BUY',
    quantity: 10,
    price: 100,
    date: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('TransactionHistory date editing', () => {
  it('pre-fills the date input with the transaction\'s current date on edit', () => {
    render(
      <TransactionHistory transactions={[makeTransaction()]} onUpdate={vi.fn()} onDelete={vi.fn()} />,
    );

    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe('2024-01-15');
  });

  it('saves the edited date along with quantity and price', () => {
    const onUpdate = vi.fn();
    render(
      <TransactionHistory transactions={[makeTransaction()]} onUpdate={onUpdate} onDelete={vi.fn()} />,
    );

    // First button in the row is Pencil (edit); enters edit mode.
    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2024-02-20' } });

    const [checkButton] = screen.getAllByRole('button');
    fireEvent.click(checkButton);

    expect(onUpdate).toHaveBeenCalledWith('txn-1', { quantity: 10, price: 100, date: '2024-02-20' });
  });

  it('does not save when the date is cleared out', () => {
    const onUpdate = vi.fn();
    render(
      <TransactionHistory transactions={[makeTransaction()]} onUpdate={onUpdate} onDelete={vi.fn()} />,
    );

    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '' } });

    const [checkButton] = screen.getAllByRole('button');
    fireEvent.click(checkButton);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
