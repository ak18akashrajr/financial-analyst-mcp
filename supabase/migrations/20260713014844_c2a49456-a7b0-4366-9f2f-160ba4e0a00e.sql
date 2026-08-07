
CREATE TABLE IF NOT EXISTS public.ticker_fundamentals (
  symbol text PRIMARY KEY,
  cape numeric,
  eps_10y jsonb,
  sector text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticker_fundamentals TO authenticated;
GRANT SELECT ON public.ticker_fundamentals TO anon;
GRANT ALL ON public.ticker_fundamentals TO service_role;

ALTER TABLE public.ticker_fundamentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on ticker_fundamentals"
  ON public.ticker_fundamentals
  FOR ALL
  USING (true)
  WITH CHECK (true);
