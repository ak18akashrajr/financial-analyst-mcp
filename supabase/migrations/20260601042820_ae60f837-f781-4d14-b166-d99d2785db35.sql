ALTER TABLE public.cash_settings ADD COLUMN IF NOT EXISTS pf_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.net_worth_history ADD COLUMN IF NOT EXISTS pf_balance numeric NOT NULL DEFAULT 0;