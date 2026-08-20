-- Backs portfolio-ai's rate limiting (security-review.md finding #2): a
-- fixed-window counter per user, so a scripted/looping caller can't run up
-- unbounded LLM API cost even after the auth fix in finding #1 restricted
-- the endpoint to real logged-in users. Accessed only by the portfolio-ai
-- edge function via the service-role key (bypasses RLS by design, same as
-- the rest of that function's DB access) — the authenticated-only policy
-- below is defense-in-depth/consistency with every other table's posture,
-- not something the client is expected to read/write directly.
create table if not exists public.ai_rate_limits (
  user_id uuid not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (user_id, window_start)
);

alter table public.ai_rate_limits enable row level security;

create policy "ai_rate_limits_authenticated_only"
  on public.ai_rate_limits
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
