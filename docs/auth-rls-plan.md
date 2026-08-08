# Real Authentication + RLS Lockdown — Migration Plan

Status: **Approved, in progress** on branch `feature/real-auth-rls`.

## Why

A security review of the current `LoginGate` found it provides no real protection:

1. **Client-side only, hardcoded credentials.** `username === 'ak18' && password === '2003'` is a
   literal string comparison shipped in the JS bundle — readable by anyone, and the "session" is
   just `sessionStorage.setItem('portfolio_auth', 'true')`, settable from DevTools with zero
   credential knowledge.
2. **One route has no gate at all.** `src/pages/Updates.tsx` was never wrapped in `<LoginGate>`.
3. **The real hole: Row Level Security grants full access to `anon`.** Every table's RLS policy is
   `USING (true) WITH CHECK (true)`. Since the Supabase URL + anon key are public (shipped in the
   client bundle, which is normal for Supabase — the problem is what the policies allow with it),
   anyone can read/write all financial data directly via the PostgREST API, completely bypassing
   the frontend, `LoginGate`, and JavaScript entirely (verified via a direct `curl` against
   `/rest/v1/transactions`).

Fixing only the login screen (Path A/B in the review) would leave Path C — the direct-API bypass —
completely open. Both need fixing together.

## What changes

### 1. Real Supabase Auth (email + password)
- `LoginGate`'s hardcoded check is replaced by `supabase.auth.signInWithPassword()`.
- Auth state comes from a real signed session (`supabase.auth.getSession()` /
  `onAuthStateChange()`), not a spoofable `sessionStorage` flag.
- **Session expires when the browser closes** (explicit choice, more conservative than a
  persistent "remember me" session): the Supabase client's `auth.storage` changes from
  `localStorage` to `sessionStorage` in `src/integrations/supabase/client.ts`.
- A sign-out action is added (didn't exist before at all).
- The developer creates their own Supabase Auth user directly in the Supabase Dashboard —
  not done via this codebase or by the assistant, consistent with not handling credentials
  directly.

### 2. Single, centralized route protection
- Replaces the previous pattern of each page individually wrapping itself in `<LoginGate>`
  (inconsistently — `Updates.tsx` was missed entirely).
- A single `<ProtectedRoute>` layout route in `src/App.tsx` wraps every route, including
  `Updates.tsx`. One gate, structurally impossible to forget on a new page.

### 3. RLS lockdown (the fix that actually matters for the direct-API bypass)
- Every table's policy changes from `USING (true) WITH CHECK (true)` to
  `USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated')`.
- Since this is confirmed single-user, no `auth.uid()`/`user_id` partitioning is added — "must be
  a logged-in Supabase Auth session" is sufficient.
- Explicit `GRANT ... TO anon` statements on `period_reports`, `market_indicators`,
  `ticker_fundamentals`, `fx_rates` are revoked.
- Applies to all 12 currently-live tables. (`benchmark_history` was created then dropped in an
  earlier migration and no longer exists — excluded here; its removal surfaced a separate latent
  bug in the MCP `compare_to_benchmark` tool, tracked separately, not part of this change.)
- **This must land after real auth exists** — locking down RLS before any real Supabase Auth
  session can be created would lock out the app entirely, including its owner.

### 4. Housekeeping
- `supabase/config.toml`'s `project_id` corrected from a stale `pxbpjgleaexvshobftli` to the
  actually-linked project `vswrkxfjrvcujmsuhucc` ("Finance DB"), confirmed via
  `supabase/.temp/linked-project.json`.

## Verification (Path C regression check)

Before the RLS migration is applied, an unauthenticated request succeeds:
```bash
curl "https://vswrkxfjrvcujmsuhucc.supabase.co/rest/v1/transactions?select=*" \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
# → full data dump
```
After, the same request (no valid user session) should be rejected:
```bash
# → empty array or 401, depending on PostgREST's handling of a failed RLS check
```
This needs to be run against the live project by the developer, not simulated here.

## Explicitly out of scope

- No multi-user partitioning (`auth.uid()`/`user_id` columns) — single-user app, per confirmed
  decision.
- No fix to the unrelated `compare_to_benchmark` / dropped `benchmark_history` table issue found
  along the way (tracked as a separate follow-up).
- No change to the MCP agent work from `feature/claude-mcp-agent` — the `portfolio-mcp-server` and
  `portfolio-ai` edge functions use the Supabase **service role** key (`SUPABASE_SERVICE_ROLE_KEY`),
  which bypasses RLS entirely by design, so this lockdown does not affect the AI chat feature.
