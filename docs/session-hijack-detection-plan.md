# Session Hijack Detection + Global Sign-Out — Design Plan

Status: **Implemented** (2026-08-29) — migrations applied and verified against the live project,
frontend built and tested. See "Implementation notes" at the end of each section below for what was
actually verified/built and where it diverged from this original plan. The plan text above each note
is kept as-written for the historical record of what was decided and why, not edited in place.

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

> **Implemented**: button lives in DevZone's new Security tab as `GlobalSignOutCard`
> ([DevZone.tsx](../src/pages/DevZone.tsx)), gated behind a `confirm()` dialog (matching the existing
> `confirm()` convention used for destructive actions elsewhere, e.g. `GoalTrack.tsx`'s delete) whose
> text restates the known limitation above verbatim, not just in this doc.

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

> **Verified** (empirically, against the live project, before any real migration was written): both
> `current_setting('request.jwt.claims', true)` and `current_setting('request.headers', true)` are
> readable inside a `SECURITY DEFINER` trigger here, via a throwaway probe table + a real `curl`
> request bearing a real access token — full method in the PR description / conversation record, not
> checked into this repo. `session_id` was confirmed present and stable. The edge-function fallback
> was not needed.
>
> One thing this check surfaced that the plan didn't anticipate: this project is fronted by
> Cloudflare, and the captured `request.headers` carries **two** IP-bearing fields —
> `cf-connecting-ip` and `x-forwarded-for`. They're not equally trustworthy: `x-forwarded-for` can be
> influenced by whatever the client sends, while `cf-connecting-ip` is set by Cloudflare's edge itself
> (overwriting any client-supplied value of the same name) and can't be spoofed by the request. The
> implemented trigger uses `cf-connecting-ip` as the primary IP source, falling back to
> `x-forwarded-for` only if it's ever absent — see
> [20260829130100_add_session_hijack_trigger.sql](../supabase/migrations/20260829130100_add_session_hijack_trigger.sql).
>
> **Caveat (accepted risk — security-review.md finding #11):** this whole check's trust boundary
> depends on Cloudflare actually fronting every request path to this project. If Cloudflare is ever
> removed, bypassed, or a direct-to-Supabase path is added without going through it, every request
> falls back to `x-forwarded-for`, which the client fully controls — an attacker can then forge
> whatever IP they like, silently defeating this mismatch check by making every request look like it
> came from one fake IP, not by tampering with any row. No action needed while Cloudflare stays in
> front of the project; the same reminder is also attached directly to the function as a Postgres
> comment, see
> [20260830100000_document_hijack_trigger_ip_source_caveat.sql](../supabase/migrations/20260830100000_document_hijack_trigger_ip_source_caveat.sql).

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

> **Implemented, with a bug caught and fixed post-deploy**: the first version of the trigger function
> compared Postgres's `TG_OP` special variable directly against lowercase `'insert'`/`'update'`/
> `'delete'` literals when deciding what to put in `old_values`/`new_values` — but `TG_OP` is always
> uppercase, so neither branch ever matched, and every incident recorded both as `null` regardless of
> operation (the incident itself still fired correctly; only the diff was missing). Caught by an
> actual replay test against live `cash_settings` (real token, real network switch, no synthetic
> data), before the DevZone UI that displays this diff was even built. Fixed in a follow-up migration,
> [20260829140000_fix_session_hijack_trigger_op_case.sql](../supabase/migrations/20260829140000_fix_session_hijack_trigger_op_case.sql)
> (the buggy migration was already applied live at that point, so the fix is a separate
> `create or replace function`, not an edit to the original file — Supabase tracks migrations as
> applied by filename, not by content). Re-verified working after the fix, with a real before/after
> diff populated.
>
> `row_id` also needed to be PK-aware rather than a single `to_jsonb(NEW) ->> 'id'` lookup as
> originally sketched: `current_prices` and `symbol_metadata` use `symbol text` as their primary key,
> not `id` (confirmed against their table definitions, not assumed) — the implemented trigger
> branches on `TG_TABLE_NAME` to pick the right column.
>
> Also implemented, not explicit in the original plan text: the trigger function is fail-open (any
> unexpected error inside it is caught and logged via `raise warning`, never blocking the underlying
> write) and row-locks the `session_fingerprints` row (`for update`) for the duration of the check, to
> avoid a race between two concurrent writes on the same `session_id` both reading a stale `last_ip`.

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

> **Implemented, with one architectural change from the plan's wording**: rather than a plain
> `useSecurityIncidents` hook called from `<ProtectedRoute>`, this is a
> `SecurityIncidentsContext`/`SecurityIncidentsProvider`
> ([SecurityIncidentsContext.tsx](../src/contexts/SecurityIncidentsContext.tsx)), mounted in
> `AppLayout` (the persistent authenticated-chrome layout nested inside `<ProtectedRoute>`, not the
> gate itself). Functionally equivalent for "checked once per session, not once per page" — both
> mount exactly once for an authenticated session in this app's route structure — but a shared context
> was necessary, not just convenient, to satisfy "clears the banner app-wide": DevZone's Security tab
> acknowledges incidents via its own separate query (it needs the full ack+unack history, the context
> only tracks the unacknowledged subset for the banner), and calling the context's `refetch()` after
> an acknowledge clears the banner immediately in the same browser tab, without a page reload. A plain
> per-component hook would have needed a full reload to reflect that.
>
> The banner itself ([SecurityIncidentBanner.tsx](../src/components/SecurityIncidentBanner.tsx)) is
> deliberately not locally dismissible (no client-side "×" that only hides it) — it only clears via
> the DB-backed acknowledge action above, which is the actual substance behind "persistent" here.

## Verification performed

Beyond the §2 GUC check above, the full pipeline was exercised against the live project with real
data before the frontend was built:

1. A real authenticated write (`cash_settings` update through the running app) produced a correct
   baseline row in `session_fingerprints` — `session_id`, `first_ip`/`last_ip` (via `cf-connecting-ip`,
   the real client IP, not an internal proxy address), and a real browser `User-Agent`.
2. A genuine replay test — the same session's real access token, reused via `curl` from a second,
   physically different network (mobile hotspot vs. home WiFi, confirmed by the IP actually changing)
   — correctly produced a `security_incidents` row with matching `session_id`, the new IP, and (after
   the `TG_OP` fix above) a populated before/after diff.
3. Re-running the same request from the *same* IP as last time correctly produced no new incident,
   confirming the mismatch check isn't just "always fire," and re-triggering it after switching
   networks again correctly fired a fresh incident.

## 5. DevZone changes

New "Security" tab alongside the existing App Logs / Audit Trail tabs
([DevZone.tsx](../src/pages/DevZone.tsx)), showing:
- The global sign-out button (§1).
- The incident list (§3) — table, operation, before/after diff (collapsed by default, same UX
  pattern as the current Audit Trail rows), IP, timestamp, acknowledge action.

> **Implemented**: filterable by unacknowledged/acknowledged/all (defaults to unacknowledged), with a
> per-row Acknowledge button. Session ID is shown truncated (`session_id.slice(0, 8)…`) in the row
> summary rather than in full, since the full incident record (with the complete `session_id`, IP, and
> user agent) is already visible in the expanded diff view.

## RLS posture for the new tables

Same pattern as `audit_logs` — `authenticated`-only policy for consistency, even though these tables
are written by trigger (running as the invoking role) and read by the DevZone UI directly. No
`user_id` partitioning, consistent with the rest of the schema (single-user app).

## Sequencing / what happens first

1. ~~**Verify the `request.headers` GUC assumption** against the live project (§2)~~ — done, see §2's
   implementation note. Confirmed viable as written; the edge-function fallback wasn't needed.
2. ~~Migration: `session_fingerprints`, `security_incidents` tables + RLS policies.~~ — done,
   [20260829130000_add_session_hijack_tables.sql](../supabase/migrations/20260829130000_add_session_hijack_tables.sql).
3. ~~Migration: trigger function + attach to the four tables in scope.~~ — done,
   [20260829130100_add_session_hijack_trigger.sql](../supabase/migrations/20260829130100_add_session_hijack_trigger.sql),
   with a follow-up fix at
   [20260829140000_fix_session_hijack_trigger_op_case.sql](../supabase/migrations/20260829140000_fix_session_hijack_trigger_op_case.sql)
   (see §3's implementation note).
4. ~~Frontend: sign-out button, `useSecurityIncidents` hook + banner, DevZone Security tab.~~ — done
   (as `SecurityIncidentsContext`, see §4's implementation note for why).
5. ~~Tests~~ — done: `src/test/dev-zone.test.tsx` (Security tab list/filter/diff/acknowledge/sign-out)
   and `src/test/app-layout.test.tsx` (banner show/hide + link target). The trigger/SQL itself has no
   Postgres-level test harness in this repo, as anticipated — it was instead verified manually against
   the live project (see "Verification performed" above), not via Vitest.

## Explicitly out of scope

- Detecting a second *independent* login (own fresh token) — not the confirmed threat model.
- Read-only hijacked-session tracking (§3).
- Real-time (push/toast) notification — banner-on-load only, per the confirmed answer.
- Instant revocation of an already-issued, still-valid access token (§1's stated limitation).
- IP-geolocation, device fingerprinting beyond raw IP + User-Agent, or any anomaly-detection scoring
  — this is a binary "same session, different IP" signal only.
