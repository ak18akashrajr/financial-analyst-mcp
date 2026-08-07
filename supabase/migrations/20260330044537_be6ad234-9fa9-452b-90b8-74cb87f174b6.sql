CREATE TABLE public.net_worth_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  net_worth numeric NOT NULL,
  portfolio_value numeric NOT NULL DEFAULT 0,
  liquid_cash numeric NOT NULL DEFAULT 0,
  vault_cash numeric NOT NULL DEFAULT 0,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.net_worth_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on net_worth_history" ON public.net_worth_history FOR ALL TO public USING (true) WITH CHECK (true);