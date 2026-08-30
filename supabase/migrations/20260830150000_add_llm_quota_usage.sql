-- Backs the opt-in OpenRouter models' (Nemotron 3 Ultra / MiniMax M2.7) free-
-- tier daily quota tracking (docs/openrouter-nemotron-plan.md). Keyed by
-- (date, model_id) rather than just a provider name, since each free model on
-- OpenRouter has its own independent daily allowance — Nemotron running out
-- must not block MiniMax, and vice versa. Same read-then-write access pattern
-- (and the same benign-race trade-off) as public.ai_rate_limits — see
-- _shared/rate-limit.ts's doc comment and this table's counterpart in
-- _shared/openrouter-quota.ts. Accessed only by the portfolio-ai edge
-- function via the service-role key (bypasses RLS by design, same as the
-- rest of that function's DB access) — the authenticated-only policy below
-- is defense-in-depth/consistency with every other table's posture, not
-- something the client is expected to read/write directly.
create table if not exists public.llm_quota_usage (
  date date not null,
  model_id text not null,
  request_count integer not null default 1,
  primary key (date, model_id)
);

alter table public.llm_quota_usage enable row level security;

create policy "llm_quota_usage_authenticated_only"
  on public.llm_quota_usage
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
