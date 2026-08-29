-- Session hijack detection: fingerprint-check trigger.
-- Design: docs/session-hijack-detection-plan.md (§2, §3).
--
-- Verified empirically against this project (see conversation record, not checked
-- in) before writing this: request.jwt.claims and request.headers are both
-- readable inside a Postgres trigger here, and the access-token JWT does carry a
-- stable `session_id` claim.
--
-- IP source: this project is fronted by Cloudflare. `cf-connecting-ip` is set by
-- Cloudflare's edge itself (overwriting any client-supplied value of the same
-- name), so it cannot be spoofed by the request the way a raw `x-forwarded-for`
-- can. It is used as the primary signal, with `x-forwarded-for` only as a
-- fallback in case a request ever arrives without it.
--
-- Fail-open (confirmed): this function must never abort the write it's attached
-- to. Every branch that can fail (bad/missing claims, malformed headers, a
-- concurrent-write edge case) is caught by the outer EXCEPTION block, which logs
-- a warning to Postgres logs and lets the underlying INSERT/UPDATE/DELETE
-- proceed untouched. AFTER-trigger timing means this never has to mutate NEW.
--
-- Scope: writes with no `session_id` claim at all (service-role/admin writes,
-- migrations) are intentionally skipped — this only tracks user-session-driven
-- writes per the plan's threat model.

create or replace function public.detect_session_hijack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
  v_headers text;
  v_session_id uuid;
  v_ip inet;
  v_user_agent text;
  v_last_ip inet;
  v_last_user_agent text;
  v_row_id text;
  v_operation text;
begin
  v_claims := current_setting('request.jwt.claims', true);
  v_headers := current_setting('request.headers', true);

  if v_claims is null or v_headers is null then
    return null; -- no request context (e.g. direct SQL/service-role) — skip.
  end if;

  v_session_id := nullif(v_claims::jsonb ->> 'session_id', '')::uuid;
  if v_session_id is null then
    return null; -- no session on this token — nothing to fingerprint.
  end if;

  v_ip := nullif(coalesce(
    v_headers::jsonb ->> 'cf-connecting-ip',
    v_headers::jsonb ->> 'x-forwarded-for'
  ), '')::inet;
  v_user_agent := v_headers::jsonb ->> 'user-agent';

  v_operation := lower(TG_OP);
  -- Primary key column differs by table: transactions/cash_settings use `id`,
  -- current_prices/symbol_metadata use `symbol` (confirmed against their table
  -- definitions, not assumed).
  v_row_id := case TG_TABLE_NAME
    when 'current_prices' then coalesce(to_jsonb(NEW) ->> 'symbol', to_jsonb(OLD) ->> 'symbol')
    when 'symbol_metadata' then coalesce(to_jsonb(NEW) ->> 'symbol', to_jsonb(OLD) ->> 'symbol')
    else coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id')
  end;

  -- Row-lock the fingerprint row (if any) for the duration of this check so two
  -- concurrent writes on the same session_id can't both read a stale last_ip.
  select last_ip, last_user_agent
    into v_last_ip, v_last_user_agent
    from public.session_fingerprints
    where session_id = v_session_id
    for update;

  if not found then
    insert into public.session_fingerprints (
      session_id, first_ip, first_user_agent, last_ip, last_user_agent,
      first_seen_at, last_seen_at
    )
    values (v_session_id, v_ip, v_user_agent, v_ip, v_user_agent, now(), now())
    on conflict (session_id) do nothing; -- lost the race to another concurrent first-write
  else
    if v_last_ip is not null and v_ip is not null and v_last_ip <> v_ip then
      insert into public.security_incidents (
        session_id, table_name, operation, row_id, old_values, new_values, ip, user_agent
      )
      values (
        v_session_id,
        TG_TABLE_NAME,
        v_operation,
        v_row_id,
        case when TG_OP in ('update', 'delete') then to_jsonb(OLD) else null end,
        case when TG_OP in ('insert', 'update') then to_jsonb(NEW) else null end,
        v_ip,
        v_user_agent
      );
    end if;

    update public.session_fingerprints
      set last_ip = v_ip, last_user_agent = v_user_agent, last_seen_at = now()
      where session_id = v_session_id;
  end if;

  return null; -- AFTER trigger — return value is ignored, NULL by convention.
exception when others then
  raise warning 'detect_session_hijack failed (fail-open, write proceeds): %', SQLERRM;
  return null;
end;
$$;

create trigger trg_detect_session_hijack_transactions
  after insert or update or delete on public.transactions
  for each row execute function public.detect_session_hijack();

create trigger trg_detect_session_hijack_cash_settings
  after insert or update or delete on public.cash_settings
  for each row execute function public.detect_session_hijack();

create trigger trg_detect_session_hijack_current_prices
  after insert or update or delete on public.current_prices
  for each row execute function public.detect_session_hijack();

create trigger trg_detect_session_hijack_symbol_metadata
  after insert or update or delete on public.symbol_metadata
  for each row execute function public.detect_session_hijack();
