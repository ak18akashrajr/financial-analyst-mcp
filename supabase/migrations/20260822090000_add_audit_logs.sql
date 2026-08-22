-- Persistent audit trail for portfolio-mcp-server tool calls (second security
-- audit, 2026-08-22 — see docs/security-review.md's addendum). Before this,
-- tool calls were only visible in Supabase's transient stdout log explorer
-- (_shared/logger.ts) — fine for live debugging, useless for after-the-fact
-- "what did the AI agent actually do, and when" investigation once those log
-- lines roll off retention.
--
-- Accessed only by portfolio-mcp-server via the service-role key (bypasses
-- RLS by design, same posture as ai_rate_limits) — the authenticated-only
-- policy below is defense-in-depth/consistency with every other table, not
-- something the client is expected to read/write directly.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  called_at timestamptz not null default now(),
  -- The calling end user's auth.users id, when portfolio-ai forwarded one
  -- (see _shared/mcp-client.ts's optional `actor` param). Nullable: a direct
  -- service-role caller (or an older client) may not supply one, and this is
  -- a best-effort trail, not an access-control mechanism.
  actor uuid,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  duration_ms integer not null,
  success boolean not null,
  error text
);

create index if not exists audit_logs_called_at_idx on public.audit_logs (called_at desc);

alter table public.audit_logs enable row level security;

create policy "audit_logs_authenticated_only"
  on public.audit_logs
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
