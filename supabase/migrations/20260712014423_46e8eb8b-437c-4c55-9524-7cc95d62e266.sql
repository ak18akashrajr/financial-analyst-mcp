CREATE TABLE public.market_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator text NOT NULL,
  value numeric NOT NULL,
  as_of date NOT NULL,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indicator, as_of)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_indicators TO authenticated;
GRANT SELECT ON public.market_indicators TO anon;
GRANT ALL ON public.market_indicators TO service_role;

ALTER TABLE public.market_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on market_indicators"
  ON public.market_indicators
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_market_indicators_updated_at
  BEFORE UPDATE ON public.market_indicators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();