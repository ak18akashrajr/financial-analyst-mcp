-- Fix security-review finding #10 (docs/security-review.md, "Third pass 2026-08-29"):
-- a hijacked/replayed session (same valid JWT, different origin) is
-- indistinguishable from the real user under `auth.role() = 'authenticated'`,
-- so the blanket `for all` policies added in
-- 20260829130000_add_session_hijack_tables.sql let that attacker silence or
-- erase the very incident their replay generated, and re-baseline
-- session_fingerprints so their own subsequent traffic stops looking
-- anomalous. Both tables are written only by the SECURITY DEFINER trigger in
-- 20260829130100_add_session_hijack_trigger.sql, which runs as the function
-- owner and so is unaffected by any of the narrowing below.

-- session_fingerprints: no frontend code reads or writes this table at all
-- (confirmed — only detect_session_hijack() touches it). Drop the blanket
-- policy and add none in its place, so `authenticated` has zero access
-- (SELECT/INSERT/UPDATE/DELETE all default-deny under RLS) and only the
-- trigger's elevated context can touch it.
drop policy if exists "session_fingerprints_authenticated_only" on public.session_fingerprints;
revoke delete on public.session_fingerprints from authenticated;

-- security_incidents: the frontend does need SELECT (banner + DevZone list)
-- and a narrow UPDATE (DevZone's "acknowledge" action, DevZone.tsx:835 —
-- .update({ acknowledged: true }).eq('id', id)). Nothing client-facing ever
-- inserts or deletes a row — only the trigger inserts, and rows should never
-- be deletable by a client-facing token at all.
drop policy if exists "security_incidents_authenticated_only" on public.security_incidents;
revoke delete on public.security_incidents from authenticated;
revoke insert on public.security_incidents from authenticated;

create policy "security_incidents_select_authenticated"
  on public.security_incidents
  for select
  using (auth.role() = 'authenticated');

-- RLS policies can't restrict which *columns* an UPDATE touches on their own —
-- USING/WITH CHECK only see whole rows. The WITH CHECK below pins the new
-- value of `acknowledged` to true (so the only legal transition is "mark
-- acknowledged"); the trigger guard that follows additionally rejects any
-- UPDATE that changes anything other than `acknowledged`, closing the gap the
-- WITH CHECK clause alone can't (e.g. a replayed-token UPDATE that sets
-- acknowledged = true *and* rewrites ip/old_values/new_values in the same
-- statement).
create policy "security_incidents_update_acknowledge_only"
  on public.security_incidents
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated' and acknowledged = true);

create or replace function public.guard_security_incidents_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.detected_at is distinct from old.detected_at
    or new.session_id is distinct from old.session_id
    or new.table_name is distinct from old.table_name
    or new.operation is distinct from old.operation
    or new.row_id is distinct from old.row_id
    or new.old_values is distinct from old.old_values
    or new.new_values is distinct from old.new_values
    or new.ip is distinct from old.ip
    or new.user_agent is distinct from old.user_agent
  then
    raise exception 'security_incidents rows are append-only except for acknowledged';
  end if;
  return new;
end;
$$;

create trigger trg_guard_security_incidents_update
  before update on public.security_incidents
  for each row execute function public.guard_security_incidents_update();
