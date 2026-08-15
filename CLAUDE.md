# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install --legacy-peer-deps   # required — @types/react vs react-markdown conflict otherwise
npm run dev                      # Vite dev server on :8080
npm run build                    # production build
npm run lint                     # eslint . (NOT run in CI — has pre-existing errors, don't chase them down as part of unrelated work)
npm test                         # vitest run — full suite (frontend + edge functions)
npm run test:watch               # vitest watch mode
npx tsc --noEmit -p tsconfig.app.json   # typecheck — required CI gate, run before every PR
```

Single test file: `npx vitest run src/test/exposure-section.test.tsx`
Single test by name: `npx vitest run -t "shows empty-state copy"`

Edge functions live under `supabase/functions/` but are tested the same way — `vitest.config.ts`
includes `supabase/functions/**/*.test.ts` and aliases the Deno `esm.sh` Supabase import to the
npm package, so the exact same source runs under Vitest/Node and the Deno edge runtime with no
forking. There is no separate Deno test command to remember.

Deploying: `npx supabase@1.190.0 login/link/db push` and
`npx supabase functions deploy --use-api` (pinned CLI version avoids a timezone-validation bug —
see [README.md](README.md) for the full deploy walkthrough, including Vercel frontend hosting).

## Repo workflow (enforced, not optional)

- Never commit directly to `main`. Branch off `main`, open a PR, merge only after all three
  required checks pass: the Vitest suite, the TypeScript typecheck (both in
  `.github/workflows/test.yml`), and a Gitleaks secret scan (`.github/workflows/secret-scan.yml`).
- Every feature/fix branch adds or updates tests covering what changed — this isn't enforced by CI,
  it's a project convention. Delete your branch (local + remote) once its PR merges.

## Architecture

### This is a single-user app

There is exactly one Supabase Auth account. RLS policies gate on
`auth.role() = 'authenticated'` only — no `user_id`/`auth.uid()` partitioning exists or is needed
(see [docs/auth-rls-plan.md](docs/auth-rls-plan.md)). Don't add multi-tenant plumbing; it'd be
unused complexity here. The Supabase client stores the session in `sessionStorage`, not
`localStorage` — sessions end when the tab closes, by design.

### Frontend data flow

There's no server-side API layer for portfolio data — [usePortfolio.ts](src/hooks/usePortfolio.ts)
queries Supabase tables (`transactions`, `cash_settings`, `current_prices`, `symbol_metadata`, …)
directly from the browser via the anon key, protected entirely by RLS. Every page under
[src/pages/](src/pages/) derives its view (holdings, exposure, tax lots, projections) from this one
hook's output using pure functions in [src/lib/](src/lib/) (`xirr.ts`, `taxCalculator.ts`,
`projectionEngine.ts`, `monteCarloAdvanced.ts`, `periodReports.ts`, etc.) — there's no separate
backend computing these numbers.

Every route in [src/App.tsx](src/App.tsx) is nested under one `<ProtectedRoute>` layout route —
this is the *only* auth gate; a page forgetting to wrap itself individually was the actual bug that
prompted the auth rewrite (see docs/auth-rls-plan.md). Add new routes inside that same `<Route>`
block, never alongside it.

### Portfolio AI: real MCP server, not prose tools

[supabase/functions/portfolio-mcp-server/](supabase/functions/portfolio-mcp-server/index.ts) is a
hand-rolled JSON-RPC 2.0 / MCP "Streamable HTTP" endpoint (single POST, no SDK transport classes —
those assume Node's http objects, which don't map onto a stateless Deno edge function). Its tools
are registered in
[supabase/functions/_shared/mcp-tools.ts](supabase/functions/_shared/mcp-tools.ts)
(`get_portfolio_summary`, `list_holdings`, `get_exposure_by_*`, `get_risk_metrics`,
`run_stress_test`, `compare_to_benchmark`, etc.), each backed by a real SQL query.

[supabase/functions/portfolio-ai/](supabase/functions/portfolio-ai/index.ts) is the agent loop that
calls those tools through [_shared/mcp-client.ts](supabase/functions/_shared/mcp-client.ts). Provider
selection is an env-var switch, not a code branch a developer maintains: Groq
(`_shared/providers/groq.ts`) is default, Claude Sonnet 5 (`_shared/providers/anthropic.ts`) is used
instead, exclusively, the moment `ANTHROPIC_API_KEY` is set — both implement the same `LlmProvider`
interface in `_shared/providers/types.ts`. On the Groq path only,
[_shared/router.ts](supabase/functions/_shared/router.ts) does zero-cost keyword-based routing
between `gpt-oss-20b`/`gpt-oss-120b`, with an escalation safety net in `portfolio-ai/index.ts` if a
"simple" turn needs too many tool calls. Full design rationale:
[docs/llm-mcp-agent-plan.md](docs/llm-mcp-agent-plan.md).

### Structured logging

Edge functions log through [_shared/logger.ts](supabase/functions/_shared/logger.ts) (single JSON
line per call: timestamp/level/fn/message/context) instead of raw `console.log`/`console.error`, so
failures are filterable in Supabase's log explorer. New edge function code should use this, not bare
console calls — see [docs/logging-monitoring.md](docs/logging-monitoring.md) for what prompted it.

### Test conventions

- Context/hook consumers are unit-tested by mocking the hook directly with `vi.mock`
  (`vi.mocked(useAuth).mockReturnValue(...)`), not by wrapping real providers around the tree — see
  [src/test/protected-route.test.tsx](src/test/protected-route.test.tsx) and
  [src/test/exposure-section.test.tsx](src/test/exposure-section.test.tsx) for the pattern.
- [src/test/setup.ts](src/test/setup.ts) stubs `ResizeObserver` and `getBoundingClientRect` so
  recharts' `ResponsiveContainer`-based charts (Treemap, Area, etc.) get a real size to lay out
  against under jsdom — without it, chart content silently renders as zero-size and tests see
  nothing. Reuse this for any new chart component's tests rather than re-solving it.
