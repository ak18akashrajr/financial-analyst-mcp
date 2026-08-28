# Session Hijack Detection + Global Sign-Out — Design Plan

Status: **Draft — not yet implemented.** Written up for review before any migration or code lands,
per the developer's request. Nothing in this doc has been built yet.

## Why

Prompted by a question about what defends against an access token being lifted straight out of the
browser's Network tab (or any other capture of a live bearer token). Current answer, established in
conversation and confirmed against the code:

- Tokens are short-lived (~1hr Supabase Auth default) and live in `sessionStorage`, not
  `localStorage` ([client.ts](../src/integrations/supabase/client.ts)) — so nothing persists past
  tab-close, but a token captured *while still valid* is fully usable by whoever has it.
- RLS on every table only checks `auth.role() = 'authenticated'`
  ([docs/auth-rls-plan.md](auth-rls-plan.md)) — single-user by design, so there is no per-user
  partitioning to limit blast radius. A valid token is total access.
- There is currently no way to notice a stolen token being used, no way to force it offline besides
  waiting out its natural expiry, and no record of what a hijacker did with it.

This plan adds three things to close that observability/response gap: a manual kill switch, passive
detection of a token being replayed from a second network origin, and a record of what a hijacked
session actually touched.

## Threat model (scoped deliberately)

Confirmed explicitly: this is about **literal token replay** — the *same* JWT (same `session_id`
claim) being used from two different network origins at once — not a second independent login with
its own fresh token. A second independent login is indistinguishable from the legitimate user on a
second device and is out of scope here.

## 1. Global sign-out button

Add a button to [DevZone.tsx](../src/pages/DevZone.tsx) that calls:

```ts
await supabase.auth.signOut({ scope: 'global' });
```

This revokes every refresh token for the account. **Known limitation, stated up front**: it does
*not* retroactively invalidate an access token already issued and still inside its ~1hr expiry —
Supabase Auth does not check a revocation list per-request by default. So this stops the token being
*renewed* after it naturally expires; it is not an instant kill of a token mid-use. If we later want
a true instant-revoke, that needs either shortening the JWT expiry significantly or adding an
explicit revocation check to `_shared/auth.ts`'s `requireUser` — noted as a possible follow-up, not
part of this plan.

## 2. Detecting replay via session fingerprinting

### Mechanism

Every Supabase JWT carries a `session_id` claim, stable for the life of one login (it survives
token refreshes — only the raw access-token string rotates). That makes it the right anchor: a
stolen copy of a live token has the *exact same* `session_id` as the legitimate one, because it's
the same JWT.

Plan:
- New table `session_fingerprints`: `session_id uuid primary key, first_ip inet, first_user_agent
  text, last_ip inet, last_user_agent text, first_seen_at timestamptz, last_seen_at timestamptz`.
- A trigger function attached to every mutable table in scope (see §3) that, on each write:
  1. Reads the current request's `session_id` from `current_setting('request.jwt.claims',
     true)::json ->> 'session_id'` (the same GUC mechanism `auth.uid()` already relies on).
  2. Reads the caller's IP/User-Agent from `current_setting('request.headers', true)::json`.
  3. Looks up `session_fingerprints` by `session_id`. First time seen → insert as the baseline.
     Already seen with a **different IP** → this is the replay signal, insert an incident (§3).
  4. Always updates `last_ip`/`last_seen_at`.

### Open technical risk — needs verifying before we build on it

Whether `request.headers` is actually readable as a GUC inside a trigger depends on PostgREST/
Supabase project configuration and isn't something to assume from general docs — it needs an
empirical check against this specific project (a throwaway trigger + one real request, confirm the
header shows up) before the schema/trigger design below is finalized. If it turns out not to be
exposed, the fallback is capturing IP/User-Agent in an edge function per write instead of a raw SQL
trigger — same outcome, more code, and it would mean writes going through `transactions` etc. can no
longer go straight from the browser to PostgREST for the tables we choose to protect this way.
**This check should happen as the first implementation step, before further migrations are written
against this design.**

### Why IP, not User-Agent, is the primary signal

User-Agent can legitimately change within the same browser session (auto-updates), so it's recorded
for the incident record but not used alone to trigger a flag. IP mismatch on an otherwise-identical
`session_id` is the actual replay signal.

## 3. Delta incident recording

Scope confirmed: **all mutable portfolio tables**, not just `transactions` —
`transactions`, `cash_settings`, `current_prices`, `symbol_metadata`.

New table `security_incidents`:
```sql
id uuid primary key default gen_random_uuid(),
detected_at timestamptz not null default now(),
session_id uuid not null,
table_name text not null,
operation text not null,        -- 'insert' | 'update' | 'delete'
row_id text,                    -- best-effort, table PK stringified
old_values jsonb,               -- to_jsonb(OLD), null on insert
new_values jsonb,               -- to_jsonb(NEW), null on delete
ip inet,
user_agent text,
acknowledged boolean not null default false
```

The same trigger from §2 populates this on every mismatch it detects, capturing `to_jsonb(OLD)` /
`to_jsonb(NEW)` so the DevZone UI can render a before/after diff using the existing `JsonBlock`
component pattern already used for the Audit Trail tab.

**Explicitly out of scope for this pass**: read-only access by a hijacked session (viewing data
without writing). Confirmed with the developer that "any action" means writes; a session that only
reads under a replayed token leaves no incident record here. Flagged as a known gap, not silently
dropped — a future pass could add read tracking via an RPC-wrapper approach, but that's a materially
bigger change (reads currently go straight through PostgREST with no per-call hook point) and isn't
part of this plan.

## 4. Notification

Confirmed: **in-app banner on next load**, not real-time push (no email/push infra exists in this
app today, and none is being added here).

- A `useSecurityIncidents` hook, queried once when `<ProtectedRoute>` mounts (so it's checked on
  every route, not just DevZone), for any `security_incidents` row with `acknowledged = false`.
- If any exist: a persistent, dismissible banner — *"Suspicious activity detected from a different
  network — see Dev Zone."* — with a link to the new Security tab.
- Dismissing/acknowledging in the DevZone Security tab sets `acknowledged = true` and clears the
  banner app-wide (single-user app, so no per-viewer state needed).

## 5. DevZone changes

New "Security" tab alongside the existing App Logs / Audit Trail tabs
([DevZone.tsx](../src/pages/DevZone.tsx)), showing:
- The global sign-out button (§1).
- The incident list (§3) — table, operation, before/after diff (collapsed by default, same UX
  pattern as the current Audit Trail rows), IP, timestamp, acknowledge action.

## RLS posture for the new tables

Same pattern as `audit_logs` — `authenticated`-only policy for consistency, even though these tables
are written by trigger (running as the invoking role) and read by the DevZone UI directly. No
`user_id` partitioning, consistent with the rest of the schema (single-user app).

## Sequencing / what happens first

1. **Verify the `request.headers` GUC assumption** against the live project (§2) — this determines
   whether the trigger-based design below is viable as written, or needs the edge-function fallback.
2. Migration: `session_fingerprints`, `security_incidents` tables + RLS policies.
3. Migration: trigger function + attach to the four tables in scope.
4. Frontend: sign-out button, `useSecurityIncidents` hook + banner, DevZone Security tab.
5. Tests: trigger behavior (can be exercised via the existing Vitest setup only for the frontend
   pieces — the trigger/SQL itself would need a manual/`supabase db` level check, since there's no
   Postgres-level test harness in this repo today), banner show/hide, sign-out button.

## Explicitly out of scope

- Detecting a second *independent* login (own fresh token) — not the confirmed threat model.
- Read-only hijacked-session tracking (§3).
- Real-time (push/toast) notification — banner-on-load only, per the confirmed answer.
- Instant revocation of an already-issued, still-valid access token (§1's stated limitation).
- IP-geolocation, device fingerprinting beyond raw IP + User-Agent, or any anomaly-detection scoring
  — this is a binary "same session, different IP" signal only.
