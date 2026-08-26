import { PiggyBank } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { InfoHint } from '@/components/InfoHint';
import type { MonthlyCashflow } from '@/types/portfolio';
import { computeExpenseToIncomeRatio, expenseToIncomeZone } from '@/lib/expenseIncomeRatio';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Props {
  cashflow: MonthlyCashflow;
}

/**
 * Auto-tracked, current-month-only expense-to-income ratio — derived from
 * Operating Cash / Cash Reserve balance deltas in usePortfolio.ts's
 * updateCash, not a manually-entered ledger. See src/lib/expenseIncomeRatio.ts.
 */
export function ExpenseIncomeRatioCard({ cashflow }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));
  const { totalIncome, totalExpense } = cashflow;
  const ratio = computeExpenseToIncomeRatio(totalExpense, totalIncome);
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground inline-flex items-center gap-1">
              Expense-to-Income Ratio
              <InfoHint
                title="Expense-to-Income Ratio"
                side="bottom"
                formula="Total Expenses ÷ Total Income × 100"
                caveat="Auto-tracked, not manually entered — a bank balance increase counts as income, a decrease as an expense."
              >
                Derived from Operating Cash / Cash Reserve balance updates this calendar month. Under 50% is ideal
                (strong surplus for savings/investing), 50–75% is manageable (basic needs covered, limited savings),
                above 75% is high risk (little left over for savings or debt payoff). Resets automatically on the 1st
                of each month.
              </InfoHint>
            </p>
            <p className="text-[11px] text-muted-foreground">{monthLabel} · auto-tracked from bank balance changes</p>
          </div>
        </div>
      </div>

      {ratio === null ? (
        <p className="text-xs text-muted-foreground py-2">
          No income recorded yet this month — update Operating Cash or Cash Reserve to start tracking.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-muted/40 rounded-md p-3">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Income (MTD)</p>
            <p className="text-xl font-bold text-foreground font-mono">{fmt(totalIncome)}</p>
          </div>
          <div className="bg-muted/40 rounded-md p-3">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Expense (MTD)</p>
            <p className="text-xl font-bold text-foreground font-mono">{fmt(totalExpense)}</p>
          </div>
          <div className={`rounded-md p-3 border col-span-2 md:col-span-2 ${expenseToIncomeZone(ratio).bg}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ratio</p>
            <p className={`text-2xl font-bold ${expenseToIncomeZone(ratio).color}`}>{ratio.toFixed(1)}%</p>
            <p className="text-[11px] text-muted-foreground">
              {expenseToIncomeZone(ratio).label} — {expenseToIncomeZone(ratio).description}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
