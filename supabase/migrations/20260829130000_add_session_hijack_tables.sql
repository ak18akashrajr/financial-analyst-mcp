-- Session hijack detection: fingerprint + incident tables.
-- Design: docs/session-hijack-detection-plan.md (§2, §3).
-- RLS pattern mirrors audit_logs / app_logs (authenticated-only, single-user app,
-- no user_id partitioning — see docs/auth-rls-plan.md).

create table public.session_fingerprints (
  session_id uuid primary key,
  first_ip inet,
  first_user_agent text,
  last_ip inet,
  last_user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.session_fingerprints enable row level security;

create policy "session_fingerprints_authenticated_only"
  on public.session_fingerprints
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  session_id uuid not null,
  table_name text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  row_id text,
  old_values jsonb,
  new_values jsonb,
  ip inet,
  user_agent text,
  acknowledged boolean not null default false
);

alter table public.security_incidents enable row level security;

create policy "security_incidents_authenticated_only"
  on public.security_incidents
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Supports the useSecurityIncidents banner query (WHERE acknowledged = false),
-- checked once per ProtectedRoute mount.
create index security_incidents_unacknowledged_idx
  on public.security_incidents (acknowledged)
  where acknowledged = false;
