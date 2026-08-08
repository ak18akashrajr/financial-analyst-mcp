-- Lock down Row Level Security: every table previously used
-- `USING (true) WITH CHECK (true)`, granting unconditional read/write access
-- to the `anon` role — meaning anyone holding the public Supabase URL + anon
-- key (both shipped in the client bundle) could read/write all data directly
-- via the PostgREST API, completely bypassing the app's login screen.
--
-- This migration must be applied AFTER real Supabase Auth exists (see
-- docs/auth-rls-plan.md) — requiring `auth.role() = 'authenticated'` before
-- any real authenticated session can be created would lock out the app
-- entirely, including its owner.
--
-- Single-user app: no auth.uid()/user_id partitioning is needed, only
-- "must be a logged-in Supabase Auth session."
--
-- Note: `benchmark_history` is intentionally excluded — it was created then
-- dropped in an earlier migration and no longer exists.
--
-- Note: the portfolio-mcp-server/portfolio-ai edge functions use
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely by design, so this
-- lockdown does not affect the AI chat feature.

-- transactions
DROP POLICY IF EXISTS "Allow all on transactions" ON public.transactions;
CREATE POLICY "Authenticated users only on transactions" ON public.transactions
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- cash_settings
DROP POLICY IF EXISTS "Allow all on cash_settings" ON public.cash_settings;
CREATE POLICY "Authenticated users only on cash_settings" ON public.cash_settings
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- current_prices
DROP POLICY IF EXISTS "Allow all on current_prices" ON public.current_prices;
CREATE POLICY "Authenticated users only on current_prices" ON public.current_prices
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- symbol_metadata
DROP POLICY IF EXISTS "Allow all on symbol_metadata" ON public.symbol_metadata;
CREATE POLICY "Authenticated users only on symbol_metadata" ON public.symbol_metadata
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- net_worth_history
DROP POLICY IF EXISTS "Allow all on net_worth_history" ON public.net_worth_history;
CREATE POLICY "Authenticated users only on net_worth_history" ON public.net_worth_history
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- goals
DROP POLICY IF EXISTS "Allow all on goals" ON public.goals;
CREATE POLICY "Authenticated users only on goals" ON public.goals
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- goal_allocations
DROP POLICY IF EXISTS "Allow all on goal_allocations" ON public.goal_allocations;
CREATE POLICY "Authenticated users only on goal_allocations" ON public.goal_allocations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- historical_prices
DROP POLICY IF EXISTS "Allow all on historical_prices" ON public.historical_prices;
CREATE POLICY "Authenticated users only on historical_prices" ON public.historical_prices
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- period_reports (also had an explicit grant to anon)
DROP POLICY IF EXISTS "Allow all on period_reports" ON public.period_reports;
CREATE POLICY "Authenticated users only on period_reports" ON public.period_reports
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.period_reports FROM anon;

-- market_indicators (also had an explicit SELECT grant to anon)
DROP POLICY IF EXISTS "Allow all on market_indicators" ON public.market_indicators;
CREATE POLICY "Authenticated users only on market_indicators" ON public.market_indicators
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE SELECT ON public.market_indicators FROM anon;

-- ticker_fundamentals (also had an explicit SELECT grant to anon)
DROP POLICY IF EXISTS "Allow all on ticker_fundamentals" ON public.ticker_fundamentals;
CREATE POLICY "Authenticated users only on ticker_fundamentals" ON public.ticker_fundamentals
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE SELECT ON public.ticker_fundamentals FROM anon;

-- fx_rates (also had an explicit grant to anon)
DROP POLICY IF EXISTS "Allow all on fx_rates" ON public.fx_rates;
CREATE POLICY "Authenticated users only on fx_rates" ON public.fx_rates
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.fx_rates FROM anon;
