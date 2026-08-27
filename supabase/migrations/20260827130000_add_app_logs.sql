-- Persisted sink for _shared/logger.ts's warn/error output, plus frontend
-- runtime errors (React error boundary, window.onerror/unhandledrejection).
-- Complements audit_logs (20260822090000_add_audit_logs.sql), which tracks
-- MCP tool calls specifically — this table is general-purpose application
-- logging, powering the "Dev Zone" page (/dev-zone).
--
-- info-level logs are deliberately NOT persisted here (see logger.ts's
-- attachSink — only warn/error entries reach the sink): this app is
-- low-traffic and "logs I want to review" means "things that went wrong",
-- not a full stdout mirror. Full info-level output remains available via
-- `supabase functions logs <fn>` as before, per docs/logging-monitoring.md.
--
-- No retention/archival job exists yet for this table, same open gap noted
-- in docs/scaling-and-archival-plan.md for other growing tables.
create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  -- 'edge' for a supabase edge function (see fn for which one), 'frontend'
  -- for a browser-side error boundary / global error handler.
  source text not null check (source in ('edge', 'frontend')),
  level text not null check (level in ('warn', 'error')),
  -- Edge: the function name passed to createLogger (e.g. "fetch-prices").
  -- Frontend: where the error was caught (e.g. "ErrorBoundary", "window.onerror").
  fn text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb
);

create index if not exists app_logs_logged_at_idx on public.app_logs (logged_at desc);
create index if not exists app_logs_level_idx on public.app_logs (level);

alter table public.app_logs enable row level security;

-- Same single-user posture as the rest of this app (see docs/auth-rls-plan.md):
-- edge functions write via the service-role key (bypasses RLS); the one real
-- authenticated frontend session both inserts its own runtime-error rows and
-- reads the Dev Zone page's log feed.
create policy "app_logs_authenticated_only"
  on public.app_logs for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
