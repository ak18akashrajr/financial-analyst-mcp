-- Request-level trace for portfolio-ai chat requests, plus a request_id
-- correlation column on the two existing log tables (audit_logs, app_logs)
-- so a single chat turn's full story — routing decision, every MCP tool
-- call it made, and any warning/error it produced — can be reconstructed by
-- joining on one id, instead of matching timestamps by eye in DevZone.
--
-- Before this: audit_logs (20260822090000) tracks tool calls, app_logs
-- (20260827130000) tracks warn/error entries, but neither carries any link
-- back to the specific chat request that caused it — see
-- docs/logging-monitoring.md and docs/llm-mcp-agent-plan.md's "Visibility"
-- item, which only ever shipped as a single stdout completion-log line
-- (portfolio-ai/index.ts's "Chat request completed").
--
-- prompt_tokens/completion_tokens/estimated_cost_usd are nullable and
-- deliberately unpopulated by this migration's companion code change — a
-- follow-up change reads each provider's response `usage` field and fills
-- these in. Columns are added now so both land in one shape rather than two
-- migrations touching a table that's brand new in the first one.
create table if not exists public.llm_requests (
  -- This IS the request_id threaded through audit_logs.request_id and
  -- app_logs.request_id below — generated once per chat request in
  -- portfolio-ai/index.ts and reused as the primary key here rather than a
  -- separate correlation column on its own row.
  id uuid primary key,
  created_at timestamptz not null default now(),
  -- The calling end user's auth.users id. Nullable for the same reason as
  -- audit_logs.actor: a best-effort trail, not an access-control mechanism.
  actor uuid,
  provider text not null,
  model text not null,
  model_preference text not null,
  status text not null check (status in ('success', 'error')),
  escalated boolean not null default false,
  open_router_fallback boolean not null default false,
  forced_grounding_retry_used boolean not null default false,
  tool_call_count integer not null default 0,
  duration_ms integer not null,
  prompt_tokens integer,
  completion_tokens integer,
  estimated_cost_usd numeric(10, 6),
  suspicious_input boolean not null default false,
  output_guardrail_triggered boolean not null default false,
  error text
);

create index if not exists llm_requests_created_at_idx on public.llm_requests (created_at desc);

alter table public.llm_requests enable row level security;

-- Same single-user posture as audit_logs/app_logs (docs/auth-rls-plan.md):
-- portfolio-ai writes via the service-role key (bypasses RLS); the
-- authenticated-only policy below is defense-in-depth/consistency, not
-- something the client needs for its own writes.
create policy "llm_requests_authenticated_only"
  on public.llm_requests
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Correlation columns on the two pre-existing log tables. Nullable: rows
-- written before this migration (and any future row from a code path that
-- genuinely has no request_id, e.g. a non-portfolio-ai edge function's own
-- app_logs entries) simply carry null here, same as audit_logs.actor always
-- has for a caller that doesn't supply one.
alter table public.audit_logs add column if not exists request_id uuid;
alter table public.app_logs add column if not exists request_id uuid;

create index if not exists audit_logs_request_id_idx on public.audit_logs (request_id);
create index if not exists app_logs_request_id_idx on public.app_logs (request_id);
