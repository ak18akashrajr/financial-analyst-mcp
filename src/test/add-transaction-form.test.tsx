// AddTransactionForm suggests tickers already seen in the transaction ledger
// (not just current holdings — a fully sold-off symbol should still
// autocomplete, since re-buying it is common) as you type the Symbol field.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddTransactionForm } from '@/components/AddTransactionForm';
import type { Transaction } from '@/types/portfolio';

function makeTxn(symbol: string): Transaction {
  return { id: symbol, symbol, type: 'BUY', quantity: 1, price: 1, date: '2026-01-01T00:00:00.000Z' };
}

function openForm(transactions: Transaction[], onAdd = vi.fn()) {
  render(<AddTransactionForm transactions={transactions} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: /add transaction/i }));
  return { onAdd, symbolInput: screen.getByPlaceholderText('Symbol (e.g. INFY.NS)') };
}

describe('AddTransactionForm ticker suggestions', () => {
  it('shows every distinct symbol from the ledger on focus, including a fully sold-off one', () => {
    // INFY.NS appears twice (dedup expected); TCS.NS is a symbol with no
    // current holding but still present in the transaction history.
    const { symbolInput } = openForm([makeTxn('INFY.NS'), makeTxn('INFY.NS'), makeTxn('TCS.NS')]);

    fireEvent.focus(symbolInput);

    expect(screen.getAllByText('INFY.NS')).toHaveLength(1);
    expect(screen.getByText('TCS.NS')).toBeInTheDocument();
  });

  it('filters suggestions as the user types, case-insensitively', () => {
    const { symbolInput } = openForm([makeTxn('INFY.NS'), makeTxn('TCS.NS')]);

    fireEvent.focus(symbolInput);
    fireEvent.change(symbolInput, { target: { value: 'inf' } });

    expect(screen.getByText('INFY.NS')).toBeInTheDocument();
    expect(screen.queryByText('TCS.NS')).not.toBeInTheDocument();
  });

  it('fills the field and closes the list when a suggestion is clicked', () => {
    const { symbolInput } = openForm([makeTxn('INFY.NS'), makeTxn('TCS.NS')]);

    fireEvent.focus(symbolInput);
    fireEvent.mouseDown(screen.getByText('TCS.NS'));

    expect(symbolInput).toHaveValue('TCS.NS');
    expect(screen.queryByText('INFY.NS')).not.toBeInTheDocument();
  });

  it('selects the highlighted suggestion on Enter after arrowing down', () => {
    const { symbolInput } = openForm([makeTxn('INFY.NS'), makeTxn('TCS.NS')]);

    fireEvent.focus(symbolInput);
    fireEvent.keyDown(symbolInput, { key: 'ArrowDown' });
    fireEvent.keyDown(symbolInput, { key: 'Enter' });

    expect(symbolInput).toHaveValue('INFY.NS');
  });

  it('submits the selected symbol along with the rest of the transaction', () => {
    const { onAdd, symbolInput } = openForm([makeTxn('INFY.NS')]);

    fireEvent.focus(symbolInput);
    fireEvent.mouseDown(screen.getByText('INFY.NS'));
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({ symbol: 'INFY.NS', type: 'BUY', quantity: 10, price: 100 });
  });
});
