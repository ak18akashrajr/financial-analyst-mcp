// Expense-to-Income ratio: pure helpers backing the "auto-tracked" income/expense
// intelligence layered on top of cash_settings bank balances (Operating Cash /
// Cash Reserve only — see usePortfolio.ts's updateCash and the monthly_cashflow
// table added in supabase/migrations/20260826120000_add_monthly_cashflow.sql).
// Pure and DB-free on purpose so this is unit-testable without a live Supabase
// connection — same shape as netWorthSnapshot.ts.

export interface CashflowZone {
  label: string;
  color: string;
  bg: string;
  description: string;
}

/**
 * IST calendar month key, e.g. "2026-08" — matches monthly_cashflow.year_month.
 * A new month naturally has no row yet, so tracking "resets" without any cron.
 */
export function getIstYearMonth(date: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD; the first 7 characters are YYYY-MM.
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

/**
 * Given the prior and new value of a bank-balance field, buckets the signed
 * delta as income (an increase) or expense (the magnitude of a decrease).
 * Only ever called for liquidCash/vaultCash — PF and credit-card-debt never
 * feed this.
 */
export function classifyBalanceDelta(previous: number, next: number): { income: number; expense: number } {
  const delta = next - previous;
  if (delta > 0) return { income: delta, expense: 0 };
  if (delta < 0) return { income: 0, expense: -delta };
  return { income: 0, expense: 0 };
}

/** Total Expenses ÷ Total Income × 100. `null` when there's no income yet to divide by. */
export function computeExpenseToIncomeRatio(totalExpense: number, totalIncome: number): number | null {
  if (totalIncome <= 0) return null;
  return (totalExpense / totalIncome) * 100;
}

export function expenseToIncomeZone(ratioPercent: number): CashflowZone {
  if (ratioPercent < 50) {
    return {
      label: 'Ideal',
      color: 'text-emerald-600',
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      description: 'Strong surplus for savings, emergencies, and investments.',
    };
  }
  if (ratioPercent <= 75) {
    return {
      label: 'Manageable',
      color: 'text-amber-600',
      bg: 'bg-amber-500/10 border-amber-500/30',
      description: 'Basic needs covered, but savings are limited — unexpected costs can strain the budget.',
    };
  }
  return {
    label: 'High Risk',
    color: 'text-red-600',
    bg: 'bg-red-500/10 border-red-500/30',
    description: 'Living on the edge — little to no money left for savings or debt payoff.',
  };
}
