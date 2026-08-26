// Covers the dashboard's Expense-to-Income Ratio card: the empty state before
// any income is recorded this month, the computed ratio + zone label, and
// privacy masking of the MTD income/expense figures.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseIncomeRatioCard } from '@/components/ExpenseIncomeRatioCard';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MonthlyCashflow } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);

function renderCard(cashflow: MonthlyCashflow) {
  return render(
    <TooltipProvider>
      <ExpenseIncomeRatioCard cashflow={cashflow} />
    </TooltipProvider>
  );
}

describe('ExpenseIncomeRatioCard', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
  });

  it('shows an empty-state message when no income has been recorded this month', () => {
    renderCard({ totalIncome: 0, totalExpense: 0 });
    expect(screen.getByText(/no income recorded yet this month/i)).toBeInTheDocument();
  });

  it('computes and labels the ratio as Ideal under 50%', () => {
    renderCard({ totalIncome: 100000, totalExpense: 40000 });
    expect(screen.getByText('40.0%')).toBeInTheDocument();
    expect(screen.getByText(/ideal/i)).toBeInTheDocument();
  });

  it('labels 50–75% as Manageable', () => {
    renderCard({ totalIncome: 100000, totalExpense: 60000 });
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText(/manageable/i)).toBeInTheDocument();
  });

  it('labels above 75% as High Risk', () => {
    renderCard({ totalIncome: 100000, totalExpense: 90000 });
    expect(screen.getByText('90.0%')).toBeInTheDocument();
    expect(screen.getByText(/high risk/i)).toBeInTheDocument();
  });

  it('masks income/expense figures in privacy-hide mode', () => {
    mockedUsePrivacy.mockReturnValue({ hidden: true, toggle: vi.fn(), mask: () => '••••••' });
    renderCard({ totalIncome: 100000, totalExpense: 40000 });
    expect(screen.getAllByText('••••••').length).toBeGreaterThanOrEqual(2);
    // The ratio percentage itself isn't a raw currency figure — stays visible.
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });
});
