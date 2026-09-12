// Covers the display-only paging in src/components/TransactionHistory.tsx —
// the one place in the app that renders an unbounded transaction list (every
// other consumer either aggregates or is bounded by construction; see
// TODO.md's paginate-transactions item for why the *fetch* deliberately still
// pulls the whole set).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionHistory, TRANSACTION_PAGE_SIZE } from '@/components/TransactionHistory';
import type { Transaction } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ mask: (v: string) => v, hidden: false, toggle: vi.fn() }),
}));

/** Newest-first, matching the order usePortfolio hands this component. */
function makeTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `txn-${i}`,
    symbol: 'TCS',
    type: 'BUY' as const,
    // Distinct quantities give each row a unique, findable value.
    quantity: count - i,
    price: 100 + i,
    date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
  }));
}

function renderHistory(transactions: Transaction[]) {
  return render(
    <TransactionHistory transactions={transactions} onUpdate={vi.fn()} onDelete={vi.fn()} />,
  );
}

/** Row count via the rendered price cells, which are one-per-row. */
function renderedRowCount(): number {
  return screen.getAllByText(/^₹\d+\.\d{2}$/).length;
}

describe('TransactionHistory paging', () => {
  it('renders every row, with no paging controls, when the list fits one page', () => {
    renderHistory(makeTransactions(TRANSACTION_PAGE_SIZE));

    expect(renderedRowCount()).toBe(TRANSACTION_PAGE_SIZE);
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument();
    // No "showing X of Y" noise when there's nothing being withheld.
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it('caps a longer list at one page and says how much is withheld', () => {
    renderHistory(makeTransactions(55));

    expect(renderedRowCount()).toBe(TRANSACTION_PAGE_SIZE);
    expect(screen.getByText(/showing 20 of 55/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show 20 more/i })).toBeInTheDocument();
  });

  it('keeps the newest rows on the first page', () => {
    // quantity counts down from the total, so the newest row is `quantity: 55`
    // and the oldest is `quantity: 1`.
    renderHistory(makeTransactions(55));

    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('appends a page per click and offers only the remainder on the last one', () => {
    renderHistory(makeTransactions(45));

    fireEvent.click(screen.getByRole('button', { name: /show 20 more/i }));
    expect(renderedRowCount()).toBe(40);
    expect(screen.getByText(/showing 40 of 45/i)).toBeInTheDocument();

    // 5 left, not another full page.
    fireEvent.click(screen.getByRole('button', { name: /show 5 more/i }));
    expect(renderedRowCount()).toBe(45);
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).not.toBeInTheDocument();
  });

  it('collapses back to the first page once expanded', () => {
    renderHistory(makeTransactions(55));

    fireEvent.click(screen.getByRole('button', { name: /show 20 more/i }));
    expect(renderedRowCount()).toBe(40);

    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(renderedRowCount()).toBe(TRANSACTION_PAGE_SIZE);
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument();
  });

  it('still renders edit and delete controls for the rows it does show', () => {
    // Paging must not cost the row actions — the whole point of keeping this
    // display-only is that nothing else about the component changes.
    const onDelete = vi.fn();
    renderHistory(makeTransactions(55));

    expect(renderedRowCount()).toBe(TRANSACTION_PAGE_SIZE);
    expect(onDelete).not.toHaveBeenCalled();
    // Two action buttons per row, plus the single "Show 20 more".
    expect(screen.getAllByRole('button')).toHaveLength(TRANSACTION_PAGE_SIZE * 2 + 1);
  });

  it('renders nothing but the heading for an empty list', () => {
    renderHistory([]);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
