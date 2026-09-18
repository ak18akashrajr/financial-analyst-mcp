-- Wraps the multi-statement portfolio mutations that used to be 2-4 separate
-- client round trips (see usePortfolio.ts) in single Postgres functions, so
-- each logical operation (add/edit/delete a transaction, edit cash, reset
-- everything) commits or rolls back as one unit instead of leaving partial
-- writes on a mid-sequence failure, and so the cash_settings read-modify-write
-- race between two tabs is closed by locking the row for the duration of the
-- function instead of round-tripping the "previous" value through the
-- browser. A single PL/pgSQL function body is one implicit transaction.
--
-- The dedupe/classification logic here intentionally mirrors the pure
-- functions in src/lib/netWorthSnapshot.ts and src/lib/expenseIncomeRatio.ts
-- (still used elsewhere, e.g. portfolioSeries.ts) — it has to be duplicated
-- in SQL to run atomically alongside the writes it gates.

CREATE OR REPLACE FUNCTION public.record_net_worth_snapshot(
  p_family_member_id uuid,
  p_liquid_cash numeric,
  p_vault_cash numeric,
  p_pf_balance numeric,
  p_credit_card_debt numeric
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_portfolio_value numeric;
  v_net_worth numeric;
  v_latest record;
BEGIN
  -- Same net-quantity-per-symbol-times-current-price calc as
  -- computePortfolioValue() in usePortfolio.ts: symbols with no current_prices
  -- row contribute 0, same as `currentPrices[sym] || 0` on the client.
  SELECT COALESCE(SUM(pos.net_qty * cp.price), 0) INTO v_portfolio_value
  FROM (
    SELECT t.symbol, SUM(CASE WHEN t.type = 'BUY' THEN t.quantity ELSE -t.quantity END) AS net_qty
    FROM public.transactions t
    WHERE t.family_member_id = p_family_member_id
    GROUP BY t.symbol
  ) pos
  JOIN public.current_prices cp ON cp.symbol = pos.symbol
  WHERE pos.net_qty > 0;

  v_net_worth := v_portfolio_value + p_liquid_cash + p_vault_cash + p_pf_balance - p_credit_card_debt;

  SELECT net_worth, portfolio_value, liquid_cash, vault_cash, pf_balance, credit_card_debt, recorded_at
    INTO v_latest
  FROM public.net_worth_history
  WHERE family_member_id = p_family_member_id
  ORDER BY recorded_at DESC
  LIMIT 1;

  -- Same "skip if it'd be a no-op today" rule as shouldSkipNetWorthSnapshot()
  -- + isSameIstCalendarDay(): a snapshot from an earlier IST calendar day
  -- never blocks today's first insert, epsilon 0.01 matches
  -- NET_WORTH_CHANGE_EPSILON.
  IF v_latest IS NOT NULL
     AND (v_latest.recorded_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND abs(v_latest.net_worth - v_net_worth) <= 0.01
     AND abs(v_latest.portfolio_value - v_portfolio_value) <= 0.01
     AND abs(v_latest.liquid_cash - p_liquid_cash) <= 0.01
     AND abs(v_latest.vault_cash - p_vault_cash) <= 0.01
     AND abs(v_latest.pf_balance - p_pf_balance) <= 0.01
     AND abs(v_latest.credit_card_debt - p_credit_card_debt) <= 0.01
  THEN
    RETURN;
  END IF;

  INSERT INTO public.net_worth_history
    (net_worth, portfolio_value, liquid_cash, vault_cash, pf_balance, credit_card_debt, family_member_id)
  VALUES
    (v_net_worth, v_portfolio_value, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt, p_family_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_transaction_and_snapshot(
  p_family_member_id uuid,
  p_symbol text,
  p_type text,
  p_quantity numeric,
  p_price numeric,
  p_liquid_cash numeric,
  p_vault_cash numeric,
  p_pf_balance numeric,
  p_credit_card_debt numeric
) RETURNS public.transactions
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_txn public.transactions;
BEGIN
  INSERT INTO public.transactions (symbol, type, quantity, price, family_member_id)
  VALUES (p_symbol, p_type, p_quantity, p_price, p_family_member_id)
  RETURNING * INTO v_txn;

  PERFORM public.record_net_worth_snapshot(p_family_member_id, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt);

  RETURN v_txn;
END;
$$;

-- p_family_member_id (and the cash fields) are NULL when the caller has the combined "All
-- Family" view active: usePortfolio.ts's original recordNetWorthSnapshot() early-returned
-- whenever activeMemberId === 'all' (there's no single member to attribute a snapshot to, and
-- `cash` is a cross-member sum, not one member's real balances) while still letting the edit
-- itself go through — the transaction list is only ever filtered to one member outside of 'all'
-- view, so this never edits a transaction that a NULL family_member_id could misattribute.
CREATE OR REPLACE FUNCTION public.update_transaction_and_snapshot(
  p_id uuid,
  p_quantity numeric,
  p_price numeric,
  p_date timestamptz,
  p_family_member_id uuid,
  p_liquid_cash numeric,
  p_vault_cash numeric,
  p_pf_balance numeric,
  p_credit_card_debt numeric
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Partial-update semantics matching the client's Partial<...> caller: an
  -- unset (NULL) argument leaves that column untouched.
  UPDATE public.transactions
  SET
    quantity = COALESCE(p_quantity, quantity),
    price = COALESCE(p_price, price),
    date = COALESCE(p_date, date)
  WHERE id = p_id;

  IF p_family_member_id IS NOT NULL THEN
    PERFORM public.record_net_worth_snapshot(p_family_member_id, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_transaction_and_snapshot(
  p_id uuid,
  p_family_member_id uuid,
  p_liquid_cash numeric,
  p_vault_cash numeric,
  p_pf_balance numeric,
  p_credit_card_debt numeric
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transactions WHERE id = p_id;

  IF p_family_member_id IS NOT NULL THEN
    PERFORM public.record_net_worth_snapshot(p_family_member_id, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cash_settings_tracked(
  p_family_member_id uuid,
  p_liquid_cash numeric,
  p_vault_cash numeric,
  p_pf_balance numeric,
  p_credit_card_debt numeric,
  p_exclude_from_cashflow boolean
) RETURNS TABLE (total_income numeric, total_expense numeric)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prev record;
  v_delta_income numeric := 0;
  v_delta_expense numeric := 0;
  v_year_month text;
BEGIN
  -- Lock the row (if it exists) for the rest of this transaction so a
  -- concurrent updateCash for the same member (e.g. a second browser tab)
  -- blocks here instead of racing against this read — closing the
  -- lost-update gap that existed when "previous value" was read on the
  -- client, days/requests apart from the write.
  SELECT liquid_cash, vault_cash INTO v_prev
  FROM public.cash_settings
  WHERE family_member_id = p_family_member_id
  FOR UPDATE;

  INSERT INTO public.cash_settings (family_member_id, liquid_cash, vault_cash, pf_balance, credit_card_debt)
  VALUES (p_family_member_id, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt)
  ON CONFLICT (family_member_id) DO UPDATE
    SET liquid_cash = EXCLUDED.liquid_cash,
        vault_cash = EXCLUDED.vault_cash,
        pf_balance = EXCLUDED.pf_balance,
        credit_card_debt = EXCLUDED.credit_card_debt;

  -- Only Operating Cash / Cash Reserve feed the ratio, same as
  -- classifyBalanceDelta() — PF and credit-card-debt never do. No prior row
  -- (a brand-new member) means no delta to classify.
  IF NOT p_exclude_from_cashflow AND v_prev IS NOT NULL THEN
    IF p_liquid_cash > v_prev.liquid_cash THEN
      v_delta_income := v_delta_income + (p_liquid_cash - v_prev.liquid_cash);
    ELSIF p_liquid_cash < v_prev.liquid_cash THEN
      v_delta_expense := v_delta_expense + (v_prev.liquid_cash - p_liquid_cash);
    END IF;

    IF p_vault_cash > v_prev.vault_cash THEN
      v_delta_income := v_delta_income + (p_vault_cash - v_prev.vault_cash);
    ELSIF p_vault_cash < v_prev.vault_cash THEN
      v_delta_expense := v_delta_expense + (v_prev.vault_cash - p_vault_cash);
    END IF;
  END IF;

  IF v_delta_income <> 0 OR v_delta_expense <> 0 THEN
    v_year_month := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
    INSERT INTO public.monthly_cashflow (year_month, family_member_id, total_income, total_expense)
    VALUES (v_year_month, p_family_member_id, v_delta_income, v_delta_expense)
    ON CONFLICT (family_member_id, year_month) DO UPDATE
      SET total_income = public.monthly_cashflow.total_income + EXCLUDED.total_income,
          total_expense = public.monthly_cashflow.total_expense + EXCLUDED.total_expense;
  END IF;

  PERFORM public.record_net_worth_snapshot(p_family_member_id, p_liquid_cash, p_vault_cash, p_pf_balance, p_credit_card_debt);

  RETURN QUERY
  SELECT mc.total_income, mc.total_expense
  FROM public.monthly_cashflow mc
  WHERE mc.family_member_id = p_family_member_id
    AND mc.year_month = to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric;
  END IF;
END;
$$;

-- Replaces the four-way Promise.all in resetAll() (usePortfolio.ts), which
-- fired all four table wipes concurrently with no rollback if one failed
-- partway — a failed cash_settings update after transactions had already
-- been deleted left the data in a genuinely mixed state.
CREATE OR REPLACE FUNCTION public.reset_all_data()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transactions;
  UPDATE public.cash_settings SET liquid_cash = 0, vault_cash = 0, pf_balance = 0, credit_card_debt = 0;
  DELETE FROM public.current_prices;
  DELETE FROM public.monthly_cashflow;
END;
$$;
