# Logging & monitoring

## What this covers

Structured logging across the Supabase Edge Functions, so failures in
external data fetches, tool calls, and the AI agent's tool loop are visible
in Supabase's log explorer instead of failing silently or scattering
free-text `console.log`/`console.error` calls.

This was prompted by the `benchmark_history` incident (see
`supabase/migrations/20260808150000_recreate_benchmark_history.sql` and the
"fail gracefully" fix) — a data-fetch failure that went unnoticed because
nothing surfaced it beyond an ad hoc `console.error`.

## What was added

- **`supabase/functions/_shared/logger.ts`** — `createLogger(fnName)` returns
  `info`/`warn`/`error`, each emitting a single JSON line
  (`{ ts, level, fn, msg, ...context }`). `Error` values in context are
  serialized to `{ name, message, stack }` instead of collapsing to `{}`.
  A `timed(label, operation)` helper logs start/success/failure with a
  `duration_ms`.
- Every edge function now uses this logger instead of bare `console.*`:
  - `fetch-prices`, `fetch-historical-prices`, `fetch-benchmark-prices`,
    `fetch-fx-rates`, `fetch-pe-ratio`, `fetch-ticker-cape` — log per-symbol
    fetch failures plus a batch summary (`requested`/`succeeded`/`failed`)
    so a partial failure is visible without reading every line.
  - `portfolio-mcp-server` — logs every `tools/call` with `duration_ms`, and
    unknown-tool requests, both previously silent.
  - `portfolio-ai` — logs chat request start (model/provider chosen),
    per-tool-call failures, and stream failures (tool-loop overflow,
    provider errors) that were previously swallowed into an SSE `error`
    event with no server-side trace.
  - `_shared/portfolio-data.ts` — the `benchmark_history`/`net_worth_history`
    query failures inside `getRiskMetrics`/`compareToBenchmark` now go
    through the same structured logger.

Tests: `supabase/functions/_shared/logger.test.ts` covers JSON shape, level
routing, context/Error serialization, and `timed()`'s success/failure paths.

## Viewing logs

```bash
supabase functions logs <function-name> --project-ref <ref>
```

Or via the Supabase dashboard → Edge Functions → Logs. Each line is valid
JSON, so it can be filtered/parsed there (e.g. `level:error`, `fn:fetch-prices`).

## Deliberately out of scope (for now)

- **No external APM/error-tracking service** (Sentry, Datadog, etc.) — not
  justified for a personal portfolio app's traffic; Supabase's built-in log
  explorer is enough to catch and diagnose failures manually.
- **No alerting** — nothing pages or emails on error. If the scheduled price
  refreshes going silently stale becomes a real problem, the next step would
  be a lightweight uptime check (e.g. a cron that checks `current_prices`'
  freshness and alerts if stale) rather than a full monitoring stack.
- **Frontend logging** is unchanged — this pass is edge-functions-only,
  where unattended cron-triggered failures are the highest-risk blind spot.
