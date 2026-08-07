-- Goals table
CREATE TABLE public.goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  target_amount NUMERIC NOT NULL DEFAULT 0,
  target_date DATE,
  icon TEXT NOT NULL DEFAULT 'Target',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on goals" ON public.goals FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_goals_updated_at
BEFORE UPDATE ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Goal allocations: link goal to a symbol or to cash, by amount
CREATE TABLE public.goal_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'symbol', -- 'symbol' | 'liquid_cash' | 'vault_cash'
  symbol TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.goal_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on goal_allocations" ON public.goal_allocations FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_goal_allocations_updated_at
BEFORE UPDATE ON public.goal_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Benchmark history (cached daily values for Nifty 50, Nifty 500, S&P 500)
CREATE TABLE public.benchmark_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(symbol, date)
);

ALTER TABLE public.benchmark_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on benchmark_history" ON public.benchmark_history FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_benchmark_history_symbol_date ON public.benchmark_history(symbol, date);