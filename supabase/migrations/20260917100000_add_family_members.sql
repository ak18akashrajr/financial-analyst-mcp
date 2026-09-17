-- Family portfolio view: lets the single authenticated user track any number of family
-- members, each with their own transactions/cash/cashflow/net-worth history, plus a combined
-- household view. This is still a single-login, single-tenant app — no auth.uid()/user_id
-- partitioning is introduced; family_members is just another authenticated-only table, same as
-- everything else (see docs/auth-rls-plan.md's confirmed single-user decision, unchanged by this
-- migration).
--
-- symbol_metadata / current_prices / historical_prices / benchmark_history / fx_rates are
-- deliberately NOT touched — they're market reference data (a symbol's sector/geography/price),
-- true regardless of which family member holds it, not personal data.

CREATE TABLE public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  relationship text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users only on family_members" ON public.family_members
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Seed a "Self" member and backfill every existing row to it, so the migration is a no-op from
-- the app's point of view — today's single portfolio becomes that one member's portfolio.
DO $$
DECLARE
  self_id uuid;
BEGIN
  INSERT INTO public.family_members (name, relationship) VALUES ('Self', 'Self')
    RETURNING id INTO self_id;

  ALTER TABLE public.transactions ADD COLUMN family_member_id uuid REFERENCES public.family_members(id);
  UPDATE public.transactions SET family_member_id = self_id WHERE family_member_id IS NULL;
  ALTER TABLE public.transactions ALTER COLUMN family_member_id SET NOT NULL;

  ALTER TABLE public.cash_settings ADD COLUMN family_member_id uuid REFERENCES public.family_members(id);
  UPDATE public.cash_settings SET family_member_id = self_id WHERE family_member_id IS NULL;
  ALTER TABLE public.cash_settings ALTER COLUMN family_member_id SET NOT NULL;
  ALTER TABLE public.cash_settings ADD CONSTRAINT cash_settings_family_member_id_key UNIQUE (family_member_id);

  ALTER TABLE public.monthly_cashflow ADD COLUMN family_member_id uuid REFERENCES public.family_members(id);
  UPDATE public.monthly_cashflow SET family_member_id = self_id WHERE family_member_id IS NULL;
  ALTER TABLE public.monthly_cashflow ALTER COLUMN family_member_id SET NOT NULL;
  ALTER TABLE public.monthly_cashflow DROP CONSTRAINT IF EXISTS monthly_cashflow_year_month_key;
  ALTER TABLE public.monthly_cashflow ADD CONSTRAINT monthly_cashflow_member_year_month_key UNIQUE (family_member_id, year_month);

  ALTER TABLE public.net_worth_history ADD COLUMN family_member_id uuid REFERENCES public.family_members(id);
  UPDATE public.net_worth_history SET family_member_id = self_id WHERE family_member_id IS NULL;
  ALTER TABLE public.net_worth_history ALTER COLUMN family_member_id SET NOT NULL;
END $$;

CREATE INDEX transactions_family_member_id_idx ON public.transactions (family_member_id);
CREATE INDEX net_worth_history_family_member_id_idx ON public.net_worth_history (family_member_id);
