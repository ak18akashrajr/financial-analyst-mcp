CREATE TABLE IF NOT EXISTS public.historical_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  date date NOT NULL,
  close numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_historical_prices_symbol_date ON public.historical_prices(symbol, date);

ALTER TABLE public.historical_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on historical_prices"
ON public.historical_prices FOR ALL
USING (true) WITH CHECK (true);