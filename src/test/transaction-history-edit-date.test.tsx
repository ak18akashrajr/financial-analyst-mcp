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

  // Audit M16: the date input holds a bare date, which Postgres reads as 00:00 UTC, so always sending it reset
  // the time of day of every edited trade and could reorder it ahead of a same-day earlier trade.
  it('does not send a date when only quantity or price was edited, so the stored timestamp is kept', () => {
    const onUpdate = vi.fn();
    render(
      <TransactionHistory
        transactions={[makeTransaction({ date: '2024-01-15T15:00:00.000Z' })]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );

    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);
    const [, priceInput] = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(priceInput, { target: { value: '105' } });

    const [checkButton] = screen.getAllByRole('button');
    fireEvent.click(checkButton);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [id, updates] = onUpdate.mock.calls[0];
    expect(id).toBe('txn-1');
    expect(updates).toEqual({ quantity: 10, price: 105 });
    expect('date' in updates).toBe(false);
  });

  it('does not send a date when the edit is saved with nothing changed', () => {
    const onUpdate = vi.fn();
    render(
      <TransactionHistory transactions={[makeTransaction()]} onUpdate={onUpdate} onDelete={vi.fn()} />,
    );

    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);
    const [checkButton] = screen.getAllByRole('button');
    fireEvent.click(checkButton);

    expect(onUpdate).toHaveBeenCalledWith('txn-1', { quantity: 10, price: 100 });
  });

  it('still sends the new date when the user does change it, even alongside a price edit', () => {
    const onUpdate = vi.fn();
    render(
      <TransactionHistory transactions={[makeTransaction()]} onUpdate={onUpdate} onDelete={vi.fn()} />,
    );

    const [editButton] = screen.getAllByRole('button');
    fireEvent.click(editButton);
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2024-03-01' } });
    const [, priceInput] = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(priceInput, { target: { value: '110' } });

    const [checkButton] = screen.getAllByRole('button');
    fireEvent.click(checkButton);

    expect(onUpdate).toHaveBeenCalledWith('txn-1', { quantity: 10, price: 110, date: '2024-03-01' });
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
