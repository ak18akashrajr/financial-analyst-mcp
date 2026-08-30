# Security Review

**Date:** 2026-08-20 (findings) / 2026-08-20 (all actionable findings fixed)
**Scope:** Full application — frontend (React/Vite), Supabase Postgres/RLS, Supabase Edge
Functions (`portfolio-ai`, `portfolio-mcp-server`, `fetch-*`), CI/CD, dependencies.
**Method:** Manual code review across auth flow, RLS policies, edge function auth/CORS/error
handling, LLM tool-call safety, secret handling, and `npm audit`. Not a penetration test —
no live requests were sent against the deployed Supabase project.

## Status

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | AI chat + MCP server callable by anyone with the public anon key | **Critical** | ✅ **Fixed** |
| 2 | No rate limiting on the LLM-backed `portfolio-ai` endpoint | High | ✅ **Fixed** |
| 3 | No security headers configured | High | ✅ **Fixed** |
| 4 | Wildcard CORS on every edge function | Medium | ✅ **Fixed** |
| 5 | Raw upstream/provider error text relayed to the client | Medium | ✅ **Fixed** |
| 6 | `react-markdown` renders LLM/DB content — safe today, one dependency away from XSS | Medium | Watch (no action needed) |
| 7 | `dangerouslySetInnerHTML` in chart theming — safe today, static inputs only | Low | Watch (no action needed) |
| 8 | `verify_jwt` posture is implicit | Low | ✅ **Fixed** (documented explicitly) |
| 9 | 17 `npm audit` findings (3 moderate, 14 high) | Info | ✅ **Fixed** — 0 findings remain (see log) |

See [Remediation log](#remediation-log) at the bottom for what changed, in which PR, and any
deploy steps that come with it (in particular: setting the `ALLOWED_ORIGIN` secret).

## TL;DR

The RLS lockdown described in [auth-rls-plan.md](auth-rls-plan.md) is real and correctly
implemented for every table reached through the normal frontend (`usePortfolio.ts` and friends).
But it did **not** cover the AI chat feature, because that feature talks to Supabase through
edge functions running with the **service-role key**, which bypasses RLS by design — and those
edge functions never independently checked that the caller was a logged-in user. The frontend even
sent the **public anon key** as the bearer token for those calls, not the user's session token.
Net effect: the login screen protected every page in the app *except* the one that reads the
entire portfolio and costs money per call. **All findings below with an action attached to them
have since been fixed** — the sections that follow describe the original findings as written
during the review, each annotated with its fix status; the [Remediation log](#remediation-log)
at the bottom has the actual diff-level detail.

---

## Critical

### 1. AI chat and MCP server are reachable by anyone with the public anon key — ✅ FIXED

> **Status: fixed** on branch `fix/ai-endpoint-auth-bypass` (see [Remediation log](#remediation-log)).
> `portfolio-ai` now requires a real user session token via a new `_shared/auth.ts` helper, and
> `portfolio-mcp-server` now only accepts calls bearing the actual service-role secret (i.e. only
> from `portfolio-ai` itself). The frontend now sends `session.access_token` instead of the anon
> key. Note `fetch-prices`/`fetch-historical-prices`/`fetch-fx-rates`/`fetch-benchmark-prices`
> were **not** in scope for this fix — see the remediation log for why and what's still open there.

**Files:**
- [supabase/functions/portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts) — never inspects the caller's identity; calls the MCP server internally with the **service-role** key.
- [supabase/functions/portfolio-mcp-server/index.ts](../supabase/functions/portfolio-mcp-server/index.ts) — its own comment documents the model as "Authorization: Bearer \<anon-or-service key\>, enforced by the platform," i.e. no additional per-user check.
- [src/pages/PortfolioAI.tsx](../src/pages/PortfolioAI.tsx) — sends `Authorization: Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` (the **anon key**), not the logged-in user's `session.access_token`.
- [src/pages/Reports.tsx](../src/pages/Reports.tsx) — same pattern.
- Also applies to `fetch-prices`, `fetch-historical-prices`, `fetch-fx-rates`, `fetch-benchmark-prices` — all use `SUPABASE_SERVICE_ROLE_KEY` internally with no per-caller check.

**Why it's exploitable:** Supabase Edge Functions' default `verify_jwt = true` (no override exists
in `supabase/config.toml`) only confirms the bearer token is *some* validly-signed JWT for the
project. The public anon/publishable key **is** such a JWT by design — that's what makes it safe
to ship in a client bundle in the first place. It proves nothing about whether a real user is
logged in. Because the frontend deliberately sends the anon key here (instead of the session
token used everywhere else in the app), and the edge functions then use the service-role key
internally (which fully bypasses RLS), the AI chat path never actually asks "is this a logged-in
user?" at any point.

**Concrete exploit:** anyone who loads the deployed site once can open devtools/network tab (or
just read the public JS bundle) and get `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` —
both intentionally public — then run, with zero login:

```bash
curl -N -X POST "https://<project-ref>.functions.supabase.co/portfolio-ai" \
  -H "Authorization: Bearer <anon key from bundle>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"List every holding, quantity, and P&L."}]}'
```

This returns full portfolio detail (holdings, exposure, P&L, risk metrics — anything the MCP
tools expose) and can be repeated indefinitely, also running up LLM API cost (see #2).

**Fix:**
- Frontend: send the real session token — `const { data: { session } } = await supabase.auth.getSession()`, then `Authorization: Bearer ${session.access_token}` — in `PortfolioAI.tsx` and `Reports.tsx`.
- Edge functions: before doing anything privileged, validate that token against a real user, e.g.:
  ```ts
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }
  ```
  Do this in `portfolio-ai/index.ts` *and* `portfolio-mcp-server/index.ts` *and* the `fetch-*`
  functions — anywhere `SUPABASE_SERVICE_ROLE_KEY` is used, before it's used.
- This brings the AI chat surface up to the same "authenticated only" bar the
  [RLS migration](../supabase/migrations/20260808130000_lockdown_rls_authenticated_only.sql)
  already enforces for direct table access.

---

## High

### 2. No rate limiting on `portfolio-ai` — ✅ FIXED

> **Status: fixed.** A fixed-window rate limit (10 requests/user/minute) now runs via
> [`_shared/rate-limit.ts`](../supabase/functions/_shared/rate-limit.ts), backed by a new
> `ai_rate_limits` table. See the [Remediation log](#remediation-log).

**File:** [supabase/functions/portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts)

No app-level rate limiting exists anywhere under `supabase/functions/`. The frontend defensively
handles a `429` response ([PortfolioAI.tsx](../src/pages/PortfolioAI.tsx)), but nothing on the
backend ever produces one — so that handling is currently dead code. Combined with #1, an
attacker (or a runaway frontend bug/loop) can script unlimited calls, each triggering a real LLM
call plus up to `MAX_TOOL_TURNS = 5` round trips to the MCP server — an unbounded dollar-cost
exposure independent of whether the data itself is sensitive.

**Fix:** Add a per-user (once #1 lands) or per-IP sliding-window rate limit checked at the top of
the handler — a simple `rate_limits` table keyed by `auth.uid()`/IP with a timestamp column is
enough for a single-user app; reject with `429` before calling the LLM provider.

### 3. No security headers configured — ✅ FIXED

> **Status: fixed.** `vercel.json` now sets the headers below on every route. See the
> [Remediation log](#remediation-log).

**Files:** [vercel.json](../vercel.json) (only `buildCommand`/`outputDirectory`/`rewrites`),
`index.html` (no CSP meta tag).

No CSP, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, or
`Referrer-Policy` are set anywhere. Without `X-Frame-Options`/`frame-ancestors`, the login and AI
chat pages can be framed by a third-party site for clickjacking. Without a CSP, there's no
defense-in-depth if an XSS vector is ever introduced (e.g. #6 below regressing). Without HSTS,
a user on a hostile network could be downgraded to plain HTTP.

**Fix:** add a `headers` block to `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' https://<project-ref>.supabase.co; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" }
      ]
    }
  ]
}
```
Tune `script-src`/`style-src` against the real build output before shipping — Vite/Tailwind
sometimes need `'unsafe-inline'` for injected styles.

---

## Medium

### 4. Wildcard CORS on every edge function — ✅ FIXED

> **Status: fixed.** Every function now builds its CORS headers via
> [`_shared/cors.ts`](../supabase/functions/_shared/cors.ts), which reads the allowed origin from
> an `ALLOWED_ORIGIN` secret (falls back to `*` only if unset). **Deploy step:** set this secret to
> your actual frontend origin — see the [Remediation log](#remediation-log) and README.

**Files:** every `corsHeaders` object under `supabase/functions/*` sets
`"Access-Control-Allow-Origin": "*"`.

For a single-known-frontend app this is unnecessarily permissive: any third-party page can call
these endpoints directly from a visitor's browser. Auth here is bearer-token (not cookie) based,
so classic CSRF doesn't apply, but a wildcard still needlessly widens the surface — especially
relevant while #1 is unfixed, since it means *any* site can drive the anon-key exploit through a
visitor's browser without the visitor even opening your site directly.

**Fix:** restrict `Access-Control-Allow-Origin` to the real production origin, read from an env
var so it's not hardcoded per environment.

### 5. Raw upstream error text relayed to the client — ✅ FIXED

> **Status: fixed.** [`_shared/sse.ts`](../supabase/functions/_shared/sse.ts) now always sends a
> fixed, generic message on error; the real detail still reaches the server-side logger via a new
> `onError` callback. See the [Remediation log](#remediation-log).

**Files:** [supabase/functions/_shared/sse.ts](../supabase/functions/_shared/sse.ts),
[_shared/providers/anthropic.ts](../supabase/functions/_shared/providers/anthropic.ts),
[_shared/providers/groq.ts](../supabase/functions/_shared/providers/groq.ts),
[portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts) top-level catch.

Provider errors (e.g. `Anthropic request failed: 401 <body>`) are embedded directly into
exception messages that get streamed straight to the browser via the SSE `error` event. This
contradicts the AI system prompt's own instruction to never reveal provider/infrastructure
details, and gives an attacker a way to fingerprint the backend or probe for misconfiguration.

**Fix:** catch provider/network errors and map them to a generic user-facing message ("the
assistant is temporarily unavailable, try again"), logging the real detail server-side only via
the existing [`_shared/logger.ts`](../supabase/functions/_shared/logger.ts).

---

## Watch (not currently exploitable, fragile)

### 6. `react-markdown` renders LLM output and DB-stored commentary

**Files:** [src/pages/PortfolioAI.tsx](../src/pages/PortfolioAI.tsx),
[src/pages/Reports.tsx](../src/pages/Reports.tsx) (`period_reports.commentary`/`highlights`/`risks`/`outlook`).

`react-markdown@10` + `remark-gfm@4` are the only markdown deps — no `rehype-raw` is installed
anywhere, so raw HTML in markdown source is stripped/escaped by default. Safe today. It becomes a
stored/reflected XSS vector the moment anyone adds `rehypePlugins={[rehypeRaw]}` (e.g. to support
rendering images), since that surface handles both LLM-streamed text and DB-stored AI-generated
commentary. Combined with #1 (unauthenticated callers can currently reach the AI endpoint), a
future prompt-injection-driven payload could actually get stored and rendered.

**Action:** no code change needed now. If raw HTML is ever required, pair `rehypeRaw` with
`rehype-sanitize` (schema-restricted) — never ship `rehypeRaw` alone.

### 7. `dangerouslySetInnerHTML` in chart theming

**File:** [src/components/ui/chart.tsx](../src/components/ui/chart.tsx) (builds a `<style>` block
from `ChartConfig.color`/`.theme`).

All current usages pass static, hardcoded per-series colors — no Supabase/LLM-sourced value
reaches this. Low residual risk today; would become a CSS-injection vector (attribute-selector
based exfiltration) if a future feature let users pick custom colors that flow into
`ChartConfig` unsanitized.

**Action:** if a dynamic/user-editable color feature is added, validate against a strict
hex/CSS-color regex before it reaches `ChartStyle`.

### 8. `verify_jwt` posture is implicit — ✅ FIXED

> **Status: fixed.** [`supabase/config.toml`](../supabase/config.toml) now explicitly declares
> `verify_jwt = true` for both functions, with a comment explaining what it does and doesn't cover.

**File:** [supabase/config.toml](../supabase/config.toml) — contains only `project_id`, no
`[functions.*]` blocks declaring `verify_jwt` explicitly.

Not wrong (defaults to `true`), but undocumented — the actual trust boundary (see #1) is easy to
misjudge from reading this file alone.

**Fix:** add explicit `[functions.portfolio-ai]` / `[functions.portfolio-mcp-server]` blocks with
`verify_jwt = true` as documentation of intent — but treat this as documentation only; it does
not substitute for the code-level per-user check in #1.

---

## Dependency vulnerabilities (`npm audit`) — ✅ FIXED

> **Status: fixed.** `npm audit fix` (non-force) resolved 13 of the 17 original findings,
> including the high-severity `@remix-run/router` XSS-via-open-redirect flagged below. The
> remaining 4 (2 advisories — `esbuild`, a *different* `react-router` issue) needed a
> major-version bump (Vite 5→8, react-router 6→7), done as its own follow-up once manually
> regression-tested. `npm audit` now reports 0 findings. See the [Remediation log](#remediation-log).

17 findings (3 moderate, 14 high) as of the original review — `nanoid`, `picomatch`, `postcss`,
`rollup`, `yaml`, `@remix-run/router`, `ajv`, `brace-expansion`, all transitive, mostly
build-tooling (Vite/Rollup/postcss toolchain) rather than runtime app code. The one user-facing one
worth calling out: **`@remix-run/router` (via `react-router`/`react-router-dom`) has a
high-severity XSS via open redirect** (GHSA-2w69-qvjg-hvjx). Fix available via `npm audit fix`
(bumps `react-router` to a patched range).

**Action:** run `npm audit fix` in a dedicated branch, re-run the full test suite + typecheck +
build, and confirm nothing breaks before merging — this repo pins `react-router-dom` and the
patch should be within the existing major version.

---

## What's already done well

- **RLS is fully locked down and consistent.** Every table reached through the normal frontend
  data path (`transactions`, `cash_settings`, `current_prices`, `symbol_metadata`,
  `net_worth_history`, `goals`, `goal_allocations`, `historical_prices`, `period_reports`,
  `market_indicators`, `ticker_fundamentals`, `fx_rates`, `benchmark_history`) has RLS enabled with
  a `USING (auth.role() = 'authenticated')` policy, and earlier `anon`-role grants were correctly
  revoked. No `USING (true)` policy remains anywhere in the migration history's final state. See
  [auth-rls-plan.md](auth-rls-plan.md).
- **`sessionStorage`, not `localStorage`, for the Supabase client** — a deliberate, documented
  choice ([src/integrations/supabase/client.ts](../src/integrations/supabase/client.ts)) so a
  session dies with the tab rather than persisting indefinitely on a shared machine.
- **Single centralized `ProtectedRoute` gate** — every route in
  [src/App.tsx](../src/App.tsx) (12 pages) is nested under one `<Route element={<ProtectedRoute />}>`
  layout route; only the `*` 404 catch-all sits outside it, correctly.
- **No secrets in the client bundle.** Only anon/publishable values are `VITE_`-prefixed;
  `SUPABASE_SERVICE_ROLE_KEY` is referenced exclusively inside edge functions via `Deno.env.get`.
  `.env.example` explicitly warns against ever putting a service-role key in a `VITE_` var. `.env`
  is gitignored and was never committed.
- **All MCP/AI tools are read-only.** Every entry in the tool registry
  ([_shared/mcp-tools.ts](../supabase/functions/_shared/mcp-tools.ts)) is annotated
  `readOnlyHint: true` / `destructiveHint: false`, and every handler only issues `.select()`
  queries — no insert/update/delete path exists for the LLM to reach, so even a successful
  prompt injection today can only read data the user already owns, not mutate it.
- **Tool arguments are schema-validated** ([_shared/mcp-schema-validate.ts](../supabase/functions/_shared/mcp-schema-validate.ts))
  before reaching any DB handler — no malformed/out-of-range args reach the query layer.
- **No SQL injection surface** — every DB access goes through the Supabase query builder
  (`.select()`, `.eq()`, `.order()`, `.limit()`); no raw SQL or string-concatenated queries
  anywhere in `_shared/portfolio-data.ts` or `_shared/mcp-tools.ts`.
- **Structured logging never logs secrets.** [_shared/logger.ts](../supabase/functions/_shared/logger.ts)
  call sites log only metadata (model, tool name, duration, error objects) — never full request
  bodies, tokens, or the `Authorization` header.
- **CI already gates on secret scanning.** [.github/workflows/secret-scan.yml](../.github/workflows/secret-scan.yml)
  runs Gitleaks on every PR/push to `main`, in addition to the Vitest suite and TypeScript
  typecheck required by [test.yml](../.github/workflows/test.yml).
- **No production source-map leak** — Vite 5 defaults `build.sourcemap` to `false` and
  [vite.config.ts](../vite.config.ts) doesn't override it.
- **LLM system prompt has real guardrails** — [portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts)
  explicitly instructs the model to treat tool output as data (not instructions), never reveal the
  system prompt or infra/vendor details, and never recommend trades — sound practice for a
  tool-using LLM, independent of the auth gap in #1.

---

## Priority remediation order (historical — all items now closed or explicitly deferred)

1. **#1 — AI chat/MCP auth bypass.** Fixed first — the one finding that actually exposed live
   data. See `fix/ai-endpoint-auth-bypass`.
2. **#2 — rate limiting**, **#3 — security headers**, **#5 — error leakage**, **#4 — CORS**, and
   **#8 — verify_jwt documentation** were fixed together in `fix/security-hardening-followups`,
   along with a non-force `npm audit fix` for #9.
3. **#9's remaining 2 findings** (esbuild, react-router) needed a major-version bump (Vite 5→8,
   react-router 6→7) — done in `fix/npm-audit-major-bump` once the codebase's actual
   React Router usage was confirmed low-risk (declarative-mode APIs only, no data-router
   features). `npm audit` now reports 0 findings.
4. **#6 / #7** — no action needed; left as guardrail notes for future feature work (adding raw
   HTML rendering or dynamic chart colors, respectively).

Per this repo's [workflow](../CLAUDE.md), each fix landed on its own feature branch with tests
added/updated, merged only after the Vitest suite, typecheck, and Gitleaks scan passed.

---

## Remediation log

### 2026-08-20 — Fixed #1: AI chat / MCP server auth bypass

**Branch:** `fix/ai-endpoint-auth-bypass` (fast-tracked ahead of the rest of the list since the
app was already deployed and this was the one finding with live data exposure).

**Changes:**
- Added [`supabase/functions/_shared/auth.ts`](../supabase/functions/_shared/auth.ts) —
  `requireUser(req)` validates the request's bearer token against Supabase Auth
  (`auth.getUser(token)`) and returns the real user, or `null` for anything that isn't an actual
  logged-in session (missing header, expired token, or the anon key itself — which does not
  belong to any user and is correctly rejected).
- [`portfolio-ai/index.ts`](../supabase/functions/portfolio-ai/index.ts) now calls `requireUser`
  first and returns 401 before doing any LLM/MCP work if it fails — closing the path where an
  unauthenticated caller could read the whole portfolio and run up LLM cost.
- [`portfolio-mcp-server/index.ts`](../supabase/functions/portfolio-mcp-server/index.ts) now
  additionally requires the caller's bearer token to be the literal service-role secret
  (constant-time compared), since this function is meant to be called only by `portfolio-ai`
  internally, never directly by a client. This is defense-in-depth on top of the `portfolio-ai`
  fix — even if that check were ever removed by mistake, the MCP server itself no longer accepts
  the public anon key.
- [`src/pages/PortfolioAI.tsx`](../src/pages/PortfolioAI.tsx) and
  [`src/pages/Reports.tsx`](../src/pages/Reports.tsx) now send `session.access_token` (from
  `supabase.auth.getSession()`) instead of the public anon key as the bearer token.
- Tests added: `supabase/functions/_shared/auth.test.ts` (helper logic),
  `supabase/functions/portfolio-ai/auth-gate.test.ts` (401 short-circuit before any LLM/MCP call),
  new "access control" cases in `supabase/functions/portfolio-mcp-server/index.test.ts`, and an
  updated `src/test/portfolio-ai-tool-trace.test.tsx` to mock the new session-token flow. Full
  suite (194 tests), typecheck, and production build all verified green before opening the PR.

**Deploy note:** `requireUser` reads `SUPABASE_ANON_KEY`, one of the secrets Supabase injects into
every edge function by default alongside `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — no new
secret needs to be configured in the Supabase dashboard for this to work, but worth confirming
once deployed (test a real chat message end-to-end; a 401 on a real login means that secret is
missing in this project for some reason).

**Explicitly not covered by this fix at the time (follow-up, lower severity):** `fetch-prices`,
`fetch-historical-prices`, `fetch-fx-rates`, and `fetch-benchmark-prices` still used the
service-role key with no per-caller check, technically the same class of gap (the platform's
`verify_jwt` alone would accept a direct anon-key call). Lower priority than #1 was, since the
frontend already reached them via `supabase.functions.invoke(...)`, which auto-attaches the
logged-in user's real session token rather than the anon key (unlike the old hand-rolled
`fetch()` calls in `PortfolioAI.tsx`/`Reports.tsx` this PR fixed) — so the practical exposure was
"anyone with the anon key can trigger a market-data refresh," not "anyone can read your
portfolio." **This follow-up has since been done** — see the `fix/security-hardening-followups`
entry below, which added the same `requireUser` gate to all four.

### 2026-08-20 — Fixed #2, #3, #4, #5, #8; partially fixed #9

**Branch:** `fix/security-hardening-followups`.

**#2 — rate limiting:**
- New [`_shared/rate-limit.ts`](../supabase/functions/_shared/rate-limit.ts): `checkRateLimit(sb,
  userId)` implements a fixed-window counter — 10 requests per user per 60-second window — backed
  by a new `ai_rate_limits` table
  ([migration](../supabase/migrations/20260820120000_add_ai_rate_limits.sql)).
- `portfolio-ai/index.ts` checks this right after `requireUser` and returns 429 before any
  LLM/MCP work if the caller is over budget.
- This is a read-then-write against the table, not a single atomic SQL increment — a benign race
  for this single-user app (see the code comment); good enough for bounding runaway cost, not
  meant as a hard security boundary.

**#3 — security headers:**
- [`vercel.json`](../vercel.json) now sets `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Strict-Transport-Security` (HSTS, 2 years + preload), `Referrer-Policy:
  strict-origin-when-cross-origin`, and a `Content-Security-Policy` scoped to `'self'` plus
  `https://*.supabase.co` for `connect-src`.

**#4 — wildcard CORS:**
- New [`_shared/cors.ts`](../supabase/functions/_shared/cors.ts): `buildCorsHeaders()` reads the
  allowed origin from an `ALLOWED_ORIGIN` secret, falling back to `*` only when that secret isn't
  set (so a fresh clone/local dev isn't blocked on configuring it immediately).
- Every edge function (`portfolio-ai`, `portfolio-mcp-server`, and all four `fetch-*` functions
  that touch the DB, plus `fetch-pe-ratio`/`fetch-ticker-cape`) now builds its CORS headers through
  this helper instead of a hardcoded `"*"`.
- **Deploy step required:** set the `ALLOWED_ORIGIN` secret to your actual deployed frontend
  origin (e.g. `https://your-app.vercel.app`) — see [README.md](../README.md)'s deployment section.
  Until set, CORS stays wide open (`*`), same as before this fix — so this is a hardening step to
  apply, not something blocking a first-time setup.

**#5 — raw error leakage:**
- [`_shared/sse.ts`](../supabase/functions/_shared/sse.ts)'s `createSseStream` now always sends a
  fixed, generic `GENERIC_CLIENT_ERROR` message on failure instead of the caught error's own
  message — the real error is still passed to a new optional `onError` callback for server-side
  logging.
- `portfolio-ai/index.ts`'s top-level catch now distinguishes a new `ValidationError` (safe,
  specific request-validation problems like a missing `messages` array — returned as-is with a
  400) from any other unexpected/internal error (generic 500 message; real detail still logged via
  `_shared/logger.ts`).

  **2026-08-23 addendum — classified, still leak-free, error messages.** A user-reported Groq 429
  surfaced as the same flat "Something went wrong" as every other failure, with no way to tell a
  rate limit apart from a real outage. [`_shared/chat-error-classifier.ts`](../supabase/functions/_shared/chat-error-classifier.ts)
  now maps a failure to one of a small fixed set of safe messages (rate limited, temporarily
  unavailable, timed out, payload too large, bad request, tool-loop exceeded, unknown) based on
  the upstream HTTP status — via a new [`HttpCallError`](../supabase/functions/_shared/http-call-error.ts)
  type thrown by both LLM providers and `_shared/mcp-client.ts`, never by parsing a status code out
  of a formatted string. The security property from the original fix is unchanged and still
  enforced by [`sse.test.ts`](../supabase/functions/_shared/sse.test.ts): every message in the
  classifier's fixed vocabulary is a hardcoded string, none of them ever interpolate the real
  status, response body, or provider name.

**#8 — `verify_jwt` posture:**
- [`supabase/config.toml`](../supabase/config.toml) now explicitly declares `[functions.portfolio-ai]`
  and `[functions.portfolio-mcp-server]` with `verify_jwt = true`, with a comment clarifying this
  platform-level check is not a substitute for the code-level `requireUser`/service-role checks
  from finding #1.

**#9 — `npm audit` — partially fixed:**
- Ran `npm audit fix` (non-force): resolved 13 of 17 findings, including the high-severity
  `@remix-run/router` XSS-via-open-redirect originally flagged. 4 findings remain, now surfaced as
  2 distinct advisories — `esbuild` (dev-server request forgery, moderate) and a *different*
  `react-router` advisory (open redirect via backslash + a deserialization issue, both moderate).
  Both require `npm audit fix --force`, which would bump Vite 5→8 and react-router 6→7 — major
  version changes deliberately **not** bundled into this fix. Tracked as a follow-up: needs its
  own branch with a full manual regression pass (Vite 8 and React Router 7 both carry breaking
  changes), not something to force through a security-hardening PR.

**Follow-up from #1's remediation log — extended the same auth gate to `fetch-*` functions:**
- `fetch-prices`, `fetch-historical-prices`, `fetch-fx-rates`, and `fetch-benchmark-prices` (the
  four that write via the service-role key) now also call `requireUser` and 401 without a real
  session, closing the same class of gap finding #1 fixed for `portfolio-ai`.
- `fetch-pe-ratio` and `fetch-ticker-cape` don't touch the service-role key or any user-specific
  data (pure external API proxies), so only their CORS headers changed.
- No frontend change was needed for these four: they're already called via
  `supabase.functions.invoke(...)` (in `usePortfolio.ts`, `useDollarReturns.ts`, `Benchmark.tsx`,
  `Reports.tsx`, `RollingReturns.tsx`), which auto-attaches the real session token — unlike the
  hand-rolled `fetch()` calls in `PortfolioAI.tsx`/`Reports.tsx`'s AI-report path that finding #1
  had to fix explicitly.

**Tests added:** `_shared/rate-limit.test.ts`, `_shared/sse.test.ts`, `portfolio-ai`'s
`rate-limit-gate.test.ts`, and an `auth-gate.test.ts` per newly-gated `fetch-*` function.
`vitest.config.ts` gained a second Supabase-client import alias (the unpinned `@2` specifier the
`fetch-*` functions use, vs. `@2.100.1` elsewhere) so those new tests can import `index.ts`. Full
suite (211 tests), typecheck, and production build all verified green before opening the PR.

### 2026-08-20 — Fixed #9's remaining findings: Vite 5→8, react-router 6→7

**Branch:** `fix/npm-audit-major-bump`.

**Why this was safe to do:** before forcing the bump, checked every `react-router-dom` import
across `src/` — only declarative-mode APIs are used (`BrowserRouter`, `Routes`, `Route`, `Link`,
`NavLink`, `Outlet`, `useLocation`, plus `MemoryRouter` in tests). No `createBrowserRouter` or
other data-router API (loaders/actions) anywhere, which is the part of the v6→v7 upgrade with
actual breaking changes — the declarative API v7 ships is designed to be a compatible superset of
v6's. This made the upgrade low-risk enough to do directly rather than deferring further.

**Changes:**
- `npm audit fix --force`: `vite` 5.4.19 → 8.2.2, `react-router-dom` 6.30.1 → 7.18.2.
- `@vitejs/plugin-react-swc` bumped 3.11.0 → 4.3.3 in the same pass — the audit-fixed Vite 8 isn't
  in that plugin version's peer range (`^4 || ^5 || ^6 || ^7`); 4.x adds `^8` support. Without this,
  npm would have force-installed an incompatible peer pairing.
- No application code changes were needed — no router API usage had to change, no Vite config
  option was removed/renamed for this project's usage.
- `npm audit` now reports **0 vulnerabilities** (down from the original 17).

**Verification:** full suite (211 tests), typecheck, and production build all green. Additionally
ran the actual dev server and drove it in a real browser: confirmed the login gate renders,
navigating to a protected route while logged out redirects correctly, and the `*` 404 route still
renders for an unknown path — the three behaviors most likely to break from a React Router major
bump. Also confirms the v6 "future flag" warnings previously seen in test output
(`v7_startTransition`, `v7_relativeSplatPath`) are gone, since those were v6-only notices asking to
opt into v7's now-default behavior early.

**Not changed:** `vite.config.ts` still uses `__dirname` (not `import.meta.dirname`) for the `@`
path alias — Vite 8's build now warns this is deprecated for its newer native config loader, but
`import.meta.dirname` needs Node ≥20.11/21.2, and this repo's stated minimum is Node 18. Left
as-is rather than silently raising the Node requirement as a side effect of a security fix; revisit
if the README's Node minimum is ever bumped for other reasons.

---

## Addendum: second audit (2026-08-22) — claim-by-claim triage

An external AI-agent audit raised 12 additional claims, framed largely around a multi-tenant
zero-trust threat model. That model doesn't map onto this app — see
[auth-rls-plan.md](auth-rls-plan.md): there is exactly one Supabase Auth account, RLS gates on
`auth.role() = 'authenticated'` only, and there's no `auth.uid()` partitioning to scope tools or
tokens against. Each claim was checked against the current code (post the 2026-08-20 remediation
above) rather than accepted at face value.

| # | Claim | Verdict | Basis |
|---|---|---|---|
| 1 | `portfolio-mcp-server` uses `service_role` | **True, by design** | Gated by `requestHasServiceRole()` (constant-time secret comparison), not caller identity — see finding #1's fix above |
| 2 | LLM jailbreak → drop tables / leak data via MCP tools | **False** | Every tool in [`_shared/mcp-tools.ts`](../supabase/functions/_shared/mcp-tools.ts) is `readOnlyHint: true` / `destructiveHint: false` and only issues `.select()` queries — no INSERT/UPDATE/DELETE/DDL path exists for a jailbroken model to reach |
| 3 | Secrets leak via function logging | **False** | [`_shared/logger.ts`](../supabase/functions/_shared/logger.ts) call sites log only metadata (tool name, duration, error) — never headers, keys, or request bodies |
| 4 | No audit log of MCP tool calls (who/what/when) | **True — real gap** | Only transient stdout logging existed; no persistent, queryable table. **Fixed in this branch** — see below |
| 5 | No rate limiting on `portfolio-ai` | **False** | Already fixed above (finding #2): 10 req/user/60s via `ai_rate_limits` |
| 6 | AI logs contain raw PII/financial data | **False** | The LLM receives the user's own portfolio data by design (that's the feature, not a leak); logs get metadata only, never message content or tool results |
| 7 | Context poisoning via bulk transaction upload | **False** | No bulk-upload feature exists anywhere in `src/` — the only insert path is a single-row `usePortfolio.ts` call, and the `transactions` table already has `CHECK` constraints on `type`/`quantity`/`price` |
| 8 | SSE streaming leaks raw stack traces | **False** | Already fixed above (finding #5): generic client-facing error, real detail server-side only |
| 9 | No key rotation strategy for Groq/Anthropic keys | **True — real gap** | No rotation runbook existed. **Fixed in this branch** — see [docs/key-rotation.md](key-rotation.md) |
| 10 | Sensitive state stored in `localStorage` | **False** | The Supabase auth session explicitly uses `sessionStorage` ([client.ts](../src/integrations/supabase/client.ts)); `localStorage` is only used for non-sensitive UI prefs (theme, nav-collapsed state, SIP target) |
| 11 | MCP tool schema exposure lets an attacker see internal DB structure | **False today** | `tools/list` exposes plain-language tool names/args (e.g. `topN`, `shockPercent`), not DB column names — and isn't reachable without the service-role secret in the first place (this *was* the original critical bug in finding #1, now fixed) |
| 12 | Cold-start exposure from uninitialized global state | **False** | No mutable module-level state in either edge function — Supabase clients and MCP clients are constructed fresh per-request |

**Net result:** 2 of 12 claims were real, net-new gaps; the rest either describe the 2026-08-20
findings already fixed above, a threat model that doesn't apply to a single-user app, or a feature
(bulk upload) that doesn't exist. Both real gaps — #4 (audit trail) and #9 (key rotation) — are
fixed in this branch.

### 2026-08-22 — Added #4: persistent audit trail for MCP tool calls

**Branch:** `feature/mcp-audit-log`.

- New `audit_logs` table ([migration](../supabase/migrations/20260822090000_add_audit_logs.sql)):
  `id`, `called_at`, `actor` (nullable end-user id), `tool_name`, `arguments`, `duration_ms`,
  `success`, `error`. Same `authenticated_only` RLS posture as `ai_rate_limits` — accessed only by
  `portfolio-mcp-server` via the service-role key.
- New [`_shared/audit-log.ts`](../supabase/functions/_shared/audit-log.ts): `recordToolCall()`
  writes one row per tool call, alongside (not instead of) the existing stdout logging. Best-effort
  by design — an insert failure is warn-logged, never thrown, so audit logging can't break a real
  tool response.
- `portfolio-mcp-server/index.ts`'s `tools/call` handler now calls `recordToolCall()` after every
  tool execution, success or failure.
- The caller's real end-user id now rides along as an `actor` field, a sibling of `arguments` in
  the JSON-RPC params — not folded into `arguments` itself, so it can't trip a tool's own
  `inputSchema` validation. [`_shared/mcp-client.ts`](../supabase/functions/_shared/mcp-client.ts)'s
  `callTool()` gained an optional third `actor` parameter; `portfolio-ai/index.ts` passes
  `user.id` (already available post-`requireUser`).
- **Not an access-control mechanism** — `actor` is unverified metadata for the audit trail only;
  admission to `portfolio-mcp-server` is still decided solely by `requestHasServiceRole()`.
- Tests added: `_shared/audit-log.test.ts` (insert shape, defaults, never-throws-on-failure),
  `_shared/mcp-client.test.ts` (actor forwarded as a JSON-RPC sibling of arguments), and a new case
  in `portfolio-mcp-server/index.test.ts` confirming `actor` doesn't get validated as an unexpected
  tool argument. Full suite (243 tests) and typecheck verified green.

### 2026-08-22 — Added #9: key rotation runbook

**Branch:** `feature/mcp-audit-log` (same branch as #4, above).

- New [docs/key-rotation.md](key-rotation.md): process documentation only, no code change. Covers
  when to rotate (suspected exposure, provider incident, handoff, routine hygiene), and the actual
  steps for each secret this app uses — `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `ALLOWED_ORIGIN`, and
  the Supabase service-role key (the most sensitive one, rotated from the dashboard rather than
  `supabase secrets set`).
- Deliberately does **not** add automated/scheduled rotation — for a single-user app, the
  operational risk of a botched automated rotation (locking yourself out of your own deployment)
  outweighs the benefit over the few-minutes manual process documented there.
- No tests apply (docs-only change); typecheck and full suite re-verified green regardless since
  they share this branch with #4's code change.

---

## Third pass (2026-08-29) — adversarial re-scan, focused on everything shipped since the last review

Everything above was re-verified still holds (`npm audit` currently reports **0 vulnerabilities**,
up-to-date as of this pass). This pass specifically targeted code merged *after* the 2026-08-22
addendum — the session-hijack-detection feature, DevZone, the landing page/auth gate, and the
recent login-animation rework — by actually reading the RLS policies, the new SQL trigger, and the
client code that calls it, rather than re-deriving the older findings.

### Status

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 10 | A hijacked session can erase its own hijack evidence (`security_incidents`/`session_fingerprints` are writable by any `authenticated` token, including a replayed one) | **High** | ✅ **Fixed** |
| 11 | `x-forwarded-for` hijack-detection fallback is client-spoofable if the Cloudflare front-door is ever bypassed or misconfigured | Low | Accepted risk — ✅ **documented** |
| 12 | New tables/pages this pass touched (`DevZone.tsx`, `Landing.tsx`, `Login.tsx`) show no new injection/XSS/credential-leak surface | — | Verified clean |

### 10. A hijacked session can tamper with, or erase, its own hijack-detection record — ✅ FIXED

> **Status: fixed** on branch `fix/session-hijack-rls-anti-tamper` (see
> [Remediation log](#remediation-log)). `session_fingerprints` now has no `authenticated`-facing
> policy at all (only the `SECURITY DEFINER` trigger can touch it); `security_incidents` keeps
> `SELECT` but its `UPDATE` policy plus a new `BEFORE UPDATE` guard trigger together restrict a
> client-facing write to flipping `acknowledged` to `true` and nothing else. `DELETE` is revoked
> from `authenticated` on both tables.

**Files:**
- [supabase/migrations/20260829130000_add_session_hijack_tables.sql](../supabase/migrations/20260829130000_add_session_hijack_tables.sql) — `security_incidents`/`session_fingerprints` RLS policies are `for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated')`, with no explicit `GRANT`/`REVOKE`, so both tables inherit this project's default schema privileges (the same pattern every other table in this app relies on) — meaning the `authenticated` Postgres role can `SELECT`/`INSERT`/`UPDATE`/`DELETE` on them directly, not just via the trigger.
- [src/pages/DevZone.tsx:835](../src/pages/DevZone.tsx) — `supabase.from('security_incidents').update({ acknowledged: true }).eq('id', id)`, a plain client-side call gated by nothing but that same RLS policy.
- [supabase/migrations/20260829130100_add_session_hijack_trigger.sql](../supabase/migrations/20260829130100_add_session_hijack_trigger.sql) — the trigger only ever *inserts* rows; nothing in this feature enforces that incidents, once written, are append-only.

**Why it's exploitable:** [docs/session-hijack-detection-plan.md](session-hijack-detection-plan.md)'s
own threat model is "the *same* JWT being used from two different network origins at once" — i.e.
an attacker who has captured a live, still-valid bearer token (network sniffing, a leaked devtools
export, a compromised proxy/extension). That attacker's requests carry `Authorization: Bearer
<the same valid token>`, so Postgres correctly evaluates `auth.role() = 'authenticated'` as **true**
for them — they are, by every RLS check in this schema, indistinguishable from the legitimate user.
Because `security_incidents`/`session_fingerprints` use that same blanket policy instead of being
read-only from the client (writable only by the `SECURITY DEFINER` trigger function), the attacker
holding the stolen token can:

1. Call the exact same `supabase.from('security_incidents').update({ acknowledged: true })...`
   the DevZone UI uses, on the incident row(s) generated by their own replay, before the legitimate
   user ever opens `/dev-zone` — the persistent banner clears the moment `acknowledged = true`, so
   this silences their own detection.
2. `DELETE FROM security_incidents WHERE id = ...` outright (same grant, same RLS check) — erasing
   the before/after diff entirely rather than just marking it acknowledged.
3. `UPDATE session_fingerprints SET last_ip = <attacker's own current IP> WHERE session_id = ...` —
   this re-baselines the fingerprint the *trigger itself* trusts, so the *next* legitimate write
   from the real user's own IP is what looks anomalous, or at minimum no further incident fires for
   the attacker's own subsequent traffic from that IP.

Net effect: the one feature purpose-built to detect and record a stolen-token replay can be
silenced or falsified using nothing more than the stolen token itself — the exact artifact the
feature assumes an attacker has. This doesn't reopen data access (that was already total, by
design, per the plan's own stated threat model), but it defeats the detection/response half of the
feature — a user checking DevZone after a real hijack could see nothing, or a fingerprint pointing
at themselves as the anomaly.

**Concrete exploit (illustrative, using the anon/public REST endpoint the frontend itself uses —
no tooling beyond `curl` and the stolen token):**
```bash
# Attacker has captured a live access token (e.g. from a network capture or a
# leaked browser export). Silence the incident their own replay just created:
curl -X PATCH "https://<project-ref>.supabase.co/rest/v1/security_incidents?id=eq.<incident-id>" \
  -H "apikey: <anon key>" \
  -H "Authorization: Bearer <stolen access token>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"acknowledged": true}'

# Or erase it outright:
curl -X DELETE "https://<project-ref>.supabase.co/rest/v1/security_incidents?id=eq.<incident-id>" \
  -H "apikey: <anon key>" \
  -H "Authorization: Bearer <stolen access token>"
```

**Fix:** the two tables need a stricter RLS split than "authenticated can do anything":
- `security_incidents`/`session_fingerprints`: `INSERT` should be restricted to the trigger's
  `SECURITY DEFINER` context only (e.g. drop the blanket `for all` policy and add narrow
  `for select`/`for update` policies that permit only the `acknowledged` column to change — Postgres
  RLS can't column-restrict directly, but a `BEFORE UPDATE` guard trigger that rejects any change
  touching `old_values`/`new_values`/`ip`/`session_id` would work), and `DELETE` should not be
  granted to `authenticated` at all (nothing in the current UI needs to delete an incident; if an
  operator ever needs to purge old rows, that's a service-role/dashboard action, not a client-facing
  one).
- Simplest fix that captures most of the value with the least new surface: `REVOKE DELETE` on both
  tables from `authenticated`, and change the `security_incidents` policy to `for update ... with
  check (acknowledged = true)` scoped so only the acknowledge flow's exact shape is legal — nothing
  else the client currently needs would break.

### 11. `x-forwarded-for` fallback in the hijack trigger — Low, accepted risk — ✅ DOCUMENTED

> **Status: documented** on branch `fix/session-hijack-rls-anti-tamper` (see
> [Remediation log](#remediation-log)). No code behavior changed — this was always an accepted
> risk, not a bug — but the caveat below is now recorded in two durable places instead of only this
> review doc: a Postgres `COMMENT ON FUNCTION` attached to `detect_session_hijack()` itself (visible
> from any DB introspection tool, not just this file), and
> [docs/session-hijack-detection-plan.md](session-hijack-detection-plan.md)'s own IP-source
> writeup.

**File:** [supabase/migrations/20260829130100_add_session_hijack_trigger.sql:54-57](../supabase/migrations/20260829130100_add_session_hijack_trigger.sql)

The trigger already documents and defends against the main version of this: `cf-connecting-ip` (set
by Cloudflare's edge, unspoofable by the client) is the primary signal, with `x-forwarded-for`
(client-influenceable) used only as a fallback when `cf-connecting-ip` is absent. Flagging only
because that fallback is a live gap *if* the Cloudflare front-door is ever removed, bypassed, or a
future direct-to-Supabase path is added without going through it — at that point every request would
fall to the spoofable header and an attacker could forge whatever IP they like, defeating the
mismatch check entirely (not by tampering with rows, but by making every request look like it came
from the same fake IP). No action needed today; worth a one-line reminder in the migration or the
plan doc that removing/bypassing Cloudflare silently downgrades this feature's core signal.

### 12. Re-checked for new injection/XSS/leak surface — clean

Specifically checked (all negative):
- `Landing.tsx`, `Login.tsx` (including the PR #100 loading-animation rework) — no raw HTML
  rendering, no credentials or tokens logged to console, no secrets in the redirect/animation
  timing logic, `Navigate` targets are hardcoded strings (`/overview`, `/login`), never
  attacker-influenced (no `?redirect=` param read from the URL anywhere in the auth flow).
- `DevZone.tsx`'s Security/App-Logs/Audit-Trail tabs — `JsonBlock` renders log/incident payloads via
  `JSON.stringify` into a `<pre>`-style text node, not `dangerouslySetInnerHTML`; no rendering path
  for stored `context`/`arguments`/`old_values`/`new_values` that could execute as markup.
- `_shared/cors.ts` — `ALLOWED_ORIGIN` is still read once at module scope with a `"*"` fallback,
  same posture as finding #4 above (not a regression, just re-confirmed still open until the secret
  is set in the deployed project).
- `npm audit` — 0 findings (was already 0 as of the 2026-08-20 remediation; re-run fresh for this
  pass to confirm no new advisories have landed against current `package-lock.json`).

---

**Updated priority order:** #10 (audit-trail tamper/anti-forensics gap) was the only actionable new
finding from this pass — **now fixed**, see below. #11 was a documentation note — **now recorded**,
see below. See [TODO.md](../TODO.md) for tracking.

### 2026-08-30 — Fixed #10: RLS anti-tamper hardening for session-hijack tables

**Branch:** `fix/session-hijack-rls-anti-tamper`.

**Changes** (all in one new migration,
[20260830090000_harden_session_hijack_rls.sql](../supabase/migrations/20260830090000_harden_session_hijack_rls.sql)):
- `session_fingerprints`: dropped the blanket `for all` policy and added none in its place —
  confirmed first that no frontend code reads or writes this table at all (only
  `detect_session_hijack()` does, running as `SECURITY DEFINER`, unaffected by RLS either way), so
  `authenticated` now has zero access (SELECT/INSERT/UPDATE/DELETE all default-deny).
- `security_incidents`: dropped the blanket `for all` policy; `REVOKE DELETE` and `REVOKE INSERT`
  from `authenticated` (nothing client-facing does either — only the trigger inserts); added a
  `for select` policy (still needed by
  [`SecurityIncidentsContext.tsx`](../src/contexts/SecurityIncidentsContext.tsx)'s banner query and
  [`DevZone.tsx`](../src/pages/DevZone.tsx)'s Security tab list) and a narrower `for update` policy
  whose `with check` pins the new `acknowledged` value to `true`.
- Because RLS `USING`/`WITH CHECK` can only see whole rows, not which columns changed, a new
  `BEFORE UPDATE` guard trigger (`guard_security_incidents_update`) additionally rejects any
  `UPDATE` that touches anything other than `acknowledged` — closing the gap a `WITH CHECK` alone
  can't (e.g. a single statement that sets `acknowledged = true` while also rewriting `ip` or
  `old_values`/`new_values`).
- No application code changes were needed — `DevZone.tsx`'s existing
  `.update({ acknowledged: true }).eq('id', id)` call already matches the one shape the new policy
  and trigger now permit.
- **Tests:** none added — this repo has no SQL/RLS test harness (`vitest` runs against mocked
  Supabase clients, not a live Postgres instance with RLS enforced), and no application code
  changed for this fix.
- **Verified live** against the real Supabase project (2026-08-30, no Docker/`supabase start`
  available in the environment this was fixed in, so verification ran directly against the real
  project instead): applied the migration via `supabase db push`, inserted a disposable test row
  into `security_incidents`, then re-ran the finding's own `curl` reproduction with a real session
  token. Results matched expectations exactly — `PATCH {"acknowledged": true}` → `204`; `PATCH
  {"acknowledged": true, "ip": ...}` → `400`/`P0001` (*"security_incidents rows are append-only
  except for acknowledged"*, the guard trigger firing); `DELETE` → `403`/`42501` (*"permission
  denied for table security_incidents"*); a bare `SELECT` on `session_fingerprints` → `200` with an
  empty array. Also confirmed via DevZone's Security tab that the real acknowledge flow and
  incident list are unaffected, then deleted the disposable test row via the SQL editor (the REST
  API can no longer do this, by design).

### 2026-08-30 — Documented #11: Cloudflare-dependency caveat on the hijack trigger's IP source

**Branch:** `fix/session-hijack-rls-anti-tamper` (same branch as #10, above).

Finding #11 was accepted risk from the start — the trigger already does the right thing
(`cf-connecting-ip` primary, `x-forwarded-for` fallback only) — so this needed a reminder, not a
code change:
- New migration
  [20260830100000_document_hijack_trigger_ip_source_caveat.sql](../supabase/migrations/20260830100000_document_hijack_trigger_ip_source_caveat.sql):
  a `COMMENT ON FUNCTION public.detect_session_hijack() IS '...'` — a real Postgres catalog comment,
  so the caveat is visible from `\df+ detect_session_hijack` or any other DB introspection tool, not
  only from this doc. `detect_session_hijack()` itself is untouched; this is purely additive.
- [docs/session-hijack-detection-plan.md](session-hijack-detection-plan.md)'s own IP-source writeup
  now states the same caveat inline, next to where it already documents the `cf-connecting-ip` /
  `x-forwarded-for` choice.
- **Did not** edit the original
  [20260829130100_add_session_hijack_trigger.sql](../supabase/migrations/20260829130100_add_session_hijack_trigger.sql)
  in place — this repo's convention (confirmed by the existing
  `20260829140000_fix_session_hijack_trigger_op_case.sql`) is that an already-applied migration is
  never edited after the fact, even for a comment-only change; a new migration is added instead.
- No tests apply (a Postgres comment isn't application behavior); typecheck and full suite
  unaffected since no `.ts`/`.tsx` file changed.
