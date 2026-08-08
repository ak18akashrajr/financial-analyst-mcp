-- Recreates `benchmark_history`, dropped in 20260506042833 and never restored.
-- Its absence made the MCP `compare_to_benchmark` tool (and the benchmark-vs-
-- historical_prices leg of `get_risk_metrics`) fail at query time with a
-- "relation does not exist" error — tracked as a follow-up in
-- docs/auth-rls-plan.md ("No fix to the unrelated compare_to_benchmark /
-- dropped benchmark_history table issue found along the way").
--
-- Same shape as the original migration (20260501012032), but created
-- authenticated-only from the start per the RLS lockdown already applied to
-- every other table in 20260808130000_lockdown_rls_authenticated_only.sql —
-- no "Allow all" policy window for this one.
CREATE TABLE public.benchmark_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(symbol, date)
);

ALTER TABLE public.benchmark_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users only on benchmark_history" ON public.benchmark_history
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_benchmark_history_symbol_date ON public.benchmark_history(symbol, date);
