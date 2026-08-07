CREATE TABLE public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair text NOT NULL DEFAULT 'USDINR',
  date date NOT NULL,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on fx_rates" ON public.fx_rates FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_fx_rates_updated_at BEFORE UPDATE ON public.fx_rates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_fx_rates_pair_date ON public.fx_rates (pair, date DESC);