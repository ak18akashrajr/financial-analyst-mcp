-- Monthly income/expense tracking, derived automatically from bank-balance
-- deltas rather than a separate manually-entered ledger. Whenever the user
-- edits Operating Cash or Cash Reserve (liquid_cash / vault_cash on
-- cash_settings), an increase is counted as income and a decrease as an
-- expense for the current calendar month (IST) — see usePortfolio.ts's
-- updateCash / classifyBalanceDelta in src/lib/expenseIncomeRatio.ts.
-- Credit-card-debt settlement and bulk data resets are excluded from this by
-- construction (they don't go through the same code path with tracking
-- enabled), since neither represents real new income or spending.
--
-- One row per month, keyed by year_month ('YYYY-MM', IST). A new month
-- simply has no row yet — tracking "resets" automatically with no cron job
-- or scheduled task needed.
CREATE TABLE public.monthly_cashflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL UNIQUE,
  total_income numeric NOT NULL DEFAULT 0,
  total_expense numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_cashflow ENABLE ROW LEVEL SECURITY;

-- Created after the RLS lockdown (see 20260808130000_lockdown_rls_authenticated_only.sql),
-- so this goes straight to the locked-down policy — no open-then-lock-down dance needed.
CREATE POLICY "Authenticated users only on monthly_cashflow" ON public.monthly_cashflow
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TRIGGER update_monthly_cashflow_updated_at
  BEFORE UPDATE ON public.monthly_cashflow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
