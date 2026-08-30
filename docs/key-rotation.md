# Key Rotation Runbook

**Status:** process documentation only — no code change required. Written in response to finding
#9 of the [second security audit addendum](security-review.md#addendum-second-audit-2026-08-22)
("no key rotation strategy for Groq/Anthropic keys"). Low severity for a single-user hobby app —
there's no team to coordinate across and no customer-facing SLA — but worth having a documented
process rather than none, since a leaked key (accidental commit, compromised laptop, provider-side
breach) is the realistic trigger, not a calendar.

## What exists today

All secrets live as Supabase Edge Function secrets (`npx supabase secrets set ...`), never in
client code or `VITE_`-prefixed env vars — see
[README.md](../README.md#5-set-the-llm-provider-secret-pick-one) and
[security-review.md](security-review.md)'s "What's already done well" section. There is currently
no scheduled or automatic rotation for any of them.

| Secret | Used by | Set via |
|---|---|---|
| `GROQ_API_KEY` | `portfolio-ai` (default LLM provider) | `npx supabase secrets set GROQ_API_KEY=...` |
| `ANTHROPIC_API_KEY` | `portfolio-ai` (used exclusively once set — see [_shared/providers](../supabase/functions/_shared/providers)) | `npx supabase secrets set ANTHROPIC_API_KEY=...` |
| `OPENROUTER_API_KEY` | `portfolio-ai` (opt-in Nemotron 3 Ultra / MiniMax M2.7 path — see [docs/openrouter-nemotron-plan.md](openrouter-nemotron-plan.md)); its absence doesn't affect the Groq/Anthropic paths at all, same as `ANTHROPIC_API_KEY`'s optionality | `npx supabase secrets set OPENROUTER_API_KEY=...` |
| `ALLOWED_ORIGIN` | every DB-touching edge function (CORS) | `npx supabase secrets set ALLOWED_ORIGIN=...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `portfolio-ai`, `portfolio-mcp-server`, `fetch-*` | injected automatically by Supabase per-project — not user-set |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | all edge functions | injected automatically by Supabase per-project — not user-set |

`SUPABASE_SERVICE_ROLE_KEY` and the anon key are project-level Supabase secrets, rotated from the
Supabase dashboard rather than `supabase secrets set` — see the "Rotating the service-role key"
section below, which is the more sensitive of the two since it bypasses RLS.

## When to rotate

- **Suspected exposure** — a key committed to git (even briefly, even on a branch since deleted),
  pasted into a chat/ticket/log by mistake, or a laptop/CI runner with local access to it was lost
  or compromised. Rotate immediately, don't wait for a schedule.
- **Provider-side incident** — Groq, Anthropic, or Supabase announces a breach or forced rotation.
- **Routine hygiene** — no hard requirement for a single-user app, but annually is a reasonable
  default if nothing else prompts it.
- **Before/after handing off** — if this project is ever handed to someone else or a collaborator
  is added, rotate every secret listed above as part of that transition (see
  [auth-rls-plan.md](auth-rls-plan.md) for why this app has no per-user isolation to fall back on
  in the meantime).

## Rotating `GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`

1. Generate a new key in the provider's console (Groq Console / Anthropic Console / OpenRouter
   dashboard) — don't revoke the old one yet.
2. `npx supabase secrets set GROQ_API_KEY="<new key>"` (or `ANTHROPIC_API_KEY` /
   `OPENROUTER_API_KEY`). This takes effect
   on the next cold start of `portfolio-ai` — no redeploy needed, but see the note on in-flight
   requests below.
3. Send one real chat message through `/portfolio-ai` in the deployed app and confirm it succeeds
   (checks the new key actually works before the old one is gone).
4. Revoke the old key in the provider's console.

**In-flight requests:** Deno edge function instances can stay warm across a secret change — Deno
does not currently expose a way to hot-reload `Deno.env.get()` mid-instance-lifetime beyond what
Supabase's platform does on redeploy/cold-start. If you need a hard cutover (e.g. the old key was
compromised, not just routinely rotated), redeploy the function
(`npx supabase functions deploy portfolio-ai --use-api`) right after step 2 to force new instances,
then do step 4.

## Rotating `ALLOWED_ORIGIN`

Only needs rotation if the frontend's deployed origin changes (e.g. moving off Vercel, or a custom
domain). `npx supabase secrets set ALLOWED_ORIGIN="https://<new-origin>"` — no key material
involved, so no revocation step.

## Rotating the Supabase service-role key

This is the most sensitive credential in the system — it bypasses RLS entirely (see
`portfolio-mcp-server`'s and `portfolio-ai`'s use of it, documented in
[security-review.md](security-review.md)). Rotated from the Supabase dashboard, not
`supabase secrets set`:

1. Supabase Dashboard → Project Settings → API → "Reset service role key" (or equivalent, per
   Supabase's current UI — this has moved before).
2. Supabase automatically re-injects the new value as `SUPABASE_SERVICE_ROLE_KEY` into every edge
   function's environment; no manual `secrets set` step for this one.
3. Redeploy edge functions if you need the new key live immediately rather than waiting for the
   next natural cold start: `npx supabase functions deploy --use-api`.
4. Confirm `portfolio-ai` still works end-to-end (step 3 of the Groq/Anthropic section, above) —
   this also exercises `portfolio-mcp-server`'s `requestHasServiceRole()` check, which compares
   against this exact value.

**Note:** rotating this key does *not* need a corresponding change anywhere in application code —
every use is `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` at call time (see
`portfolio-mcp-server/index.ts`'s `getSupabaseClient()`), never cached at module scope (also closes
out audit claim #12, "cold start exposure from stale global state" — there is none to go stale).

## What's intentionally out of scope

Automatic/scheduled rotation (e.g. a cron job that rotates keys on a timer without a human
trigger) is not implemented and not recommended here — for a single-user app the operational risk
of a botched automated rotation (locking yourself out of your own deployed app) outweighs the
benefit over the manual process above, which takes a few minutes when actually needed.
