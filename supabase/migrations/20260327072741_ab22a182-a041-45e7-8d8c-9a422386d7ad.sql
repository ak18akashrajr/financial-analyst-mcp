
CREATE TABLE public.symbol_metadata (
  symbol text PRIMARY KEY,
  geography text NOT NULL DEFAULT 'India',
  sector text NOT NULL DEFAULT 'Equity',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.symbol_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on symbol_metadata" ON public.symbol_metadata FOR ALL TO public USING (true) WITH CHECK (true);
