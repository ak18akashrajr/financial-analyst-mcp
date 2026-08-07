-- Transactions table
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL CHECK (price > 0),
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Cash settings table (single row)
CREATE TABLE public.cash_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  liquid_cash NUMERIC NOT NULL DEFAULT 0,
  vault_cash NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Current prices cache
CREATE TABLE public.current_prices (
  symbol TEXT NOT NULL PRIMARY KEY,
  price NUMERIC NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.current_prices ENABLE ROW LEVEL SECURITY;

-- Open policies (no auth for now)
CREATE POLICY "Allow all on transactions" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on cash_settings" ON public.cash_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on current_prices" ON public.current_prices FOR ALL USING (true) WITH CHECK (true);

-- Insert default cash settings row
INSERT INTO public.cash_settings (liquid_cash, vault_cash) VALUES (0, 0);

-- Function to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cash_settings_updated_at
  BEFORE UPDATE ON public.cash_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_current_prices_updated_at
  BEFORE UPDATE ON public.current_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();