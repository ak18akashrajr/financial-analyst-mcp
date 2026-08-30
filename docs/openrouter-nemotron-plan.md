# Portfolio AI: OpenRouter (Nemotron 3 Ultra / MiniMax M2.7) as Third Provider — Plan

Status: **Not started** — documented for later implementation, tracked here so both of us can pick
it up. Companion to [llm-mcp-agent-plan.md](llm-mcp-agent-plan.md), which this extends rather than
replaces.

## Why

Groq (`gpt-oss-20b`/`gpt-oss-120b`) is the default provider; Claude Sonnet 5 replaces it entirely
once `ANTHROPIC_API_KEY` is set (not available yet — out of scope for this change). Two free
OpenRouter models are candidates for the same "opt-in / auto-escalation" slot, and both are
verified to fit our tool-use agent loop:

### NVIDIA Nemotron 3 Ultra (550B total / 55B active MoE)

- Accepts `tools`/`tool_choice` in an OpenAI-compatible chat-completions format — same shape our
  `LlmProvider` interface and `groq.ts` already use.
- Competitive with GPT-4o on BFCL and τ-bench (tool-calling/agentic benchmarks); beats
  trillion-parameter models on ProfBench, per NVIDIA's own benchmarks.
- 1M token context window, up to 65,536 completion tokens — well beyond `gpt-oss-20b`/`120b`,
  useful for queries whose tool-result JSON (holdings, exposure tables, stress-test output) is large.
- **Caveat (confirmed, no longer approximate)**: free-tier rate limit is **20 RPM / 200 RPD**,
  confirmed directly from OpenRouter's model page and cross-checked against independent trackers —
  this was previously listed here as an unconfirmed secondary-source figure; it's now settled.
- **Caveat**: does **not** support `response_format`, so JSON output isn't enforced by the API —
  only via prompting/parsing. Check whether `mcp-client.ts` tool-result parsing assumes strict JSON
  mode anywhere before wiring this in; if so, this model needs tolerant parsing on that path.

### MiniMax M2.7 (added — candidate for the same slot, not a fourth provider)

- Also OpenAI-compatible `tools`/`tool_choice` support, same `LlmProvider` shape.
- **Advantage over Nemotron**: supports structured outputs via JSON schema in `response_format` —
  removes the tolerant-parsing concern noted above for Nemotron.
- Strong agentic/tool-use benchmark performance (46.3% on Toolathon, global top tier for a free
  model) and large context (M2.7 itself; sibling M3 offers ~1.05M context if we need to go bigger).
- **Caveat**: free-tier RPM/RPD not independently confirmed at doc-writing time — confirm against
  OpenRouter's dashboard/docs before relying on a specific number, same discipline as Nemotron's
  numbers required before this doc's last update.
- Positioned here as an **alternative or companion to Nemotron for the same escalation slot**, not
  as a separate always-on path — see "Provider selection" below for how the two coexist.

Both are wired in as an *option and conditional auto-route*, never a default replacement for Groq.

## Goals

1. Add OpenRouter as a **third provider**, additive only — Anthropic-first and Groq-default
   selection in `buildProvider()` stay exactly as they are today. OpenRouter itself can serve either
   Nemotron 3 Ultra or MiniMax M2.7 depending on `modelPreference`; it's one provider file with a
   configurable model id, not two separate provider implementations.
2. Let the end user **explicitly opt into Nemotron or MiniMax** from the chat UI, with a visible
   warning about the tight free-tier quota, so they choose deliberately for a question that needs
   the bigger context/tool-reasoning, not by accident.
3. Add an **automatic complexity-based route** to one OpenRouter model (default: Nemotron, see
   "Provider selection" for how MiniMax factors in) for queries the existing heuristic already flags
   as complex (reusing `isComplexQuery`/`shouldEscalate` signals), gated by a daily quota counter so
   auto-routing degrades gracefully to `gpt-oss-120b` instead of erroring once the quota's
   near-exhausted.
4. Whichever path triggers an OpenRouter model, a rate-limit/quota failure must **fall back to
   Groq** transparently (with an honest `attribution` string), never surface a raw 429 to the user.
5. Before committing to one model as the default auto-escalation target, do a **quick bench-off**
   between Nemotron and MiniMax M2.7 on a handful of real multi-tool-call portfolio questions
   (see rollout task 9) — pick whichever is more reliable in practice, not by benchmark claims alone.

## Target architecture (delta over llm-mcp-agent-plan.md)

```
Browser (src/pages/PortfolioAI.tsx)
      │  SSE chat request: { messages, modelPreference?: 'auto' | 'nemotron' | 'minimax' }
      ▼
Edge Function: portfolio-ai
      │  buildProvider():
      │    1. ANTHROPIC_API_KEY set?          → Claude Sonnet 5 (unchanged, untouched by this work)
      │    2. modelPreference === 'nemotron'   → OpenRouterProvider(nemotron), IF daily quota not
      │       or 'minimax'                       exhausted for that model, else fall back to Groq +
      │                                          note in attribution
      │    3. else Groq default path:
      │         - router.isComplexQuery() / shouldEscalate() flags complex
      │           AND the configured default escalation model's daily quota has headroom
      │           → OpenRouterProvider (auto-escalation target, replacing gpt-oss-120b for this turn)
      │         - else → existing gpt-oss-20b / gpt-oss-120b tiering, unchanged
      │    On any OpenRouter HttpCallError (429/5xx) → retry same turn on Groq gpt-oss-120b,
      │    attribution records the fallback.
      ▼
providers/openrouter.ts (new) — OpenAI-compatible chat-completions client, same LlmProvider shape
as groq.ts. Endpoint: https://openrouter.ai/api/v1/chat/completions
Model id, selected by modelPreference (or the configured auto-escalation default):
  - nvidia/nemotron-3-ultra-550b-a55b:free
  - minimax/minimax-m2.7:free
```

Quota is tracked **per model id**, not per provider — Nemotron and MiniMax each get their own
`llm_quota_usage` row/counter (see "Rate-limit / quota strategy" below), since they're separate
free-tier allowances on OpenRouter.

## Provider selection (updated table)

| Provider | Model | Role | Trigger |
|---|---|---|---|
| Anthropic | `claude-sonnet-5` | Full replacement | `ANTHROPIC_API_KEY` set (unchanged, not available yet) |
| Groq | `openai/gpt-oss-20b` | Cheap/fast tier | Default for heuristically "simple" queries |
| Groq | `openai/gpt-oss-120b` | Capability tier | Complex queries / escalated, or OpenRouter fallback target |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` | Opt-in / auto-escalation for complex queries | User explicitly selects it, or auto-route when complex **and** its daily quota has headroom |
| OpenRouter | `minimax/minimax-m2.7:free` | Opt-in alternative for complex queries; candidate for the auto-escalation default pending the bench-off (goal 5) | User explicitly selects it, or auto-route if it wins the bench-off **and** its daily quota has headroom |

## Rate-limit / quota strategy

- Track OpenRouter requests-used-today in a small Supabase table (e.g. `llm_quota_usage(date,
  model_id, count)` — keyed by `model_id`, not just `provider`, since Nemotron and MiniMax have
  independent free-tier allowances) or a KV-style row, incremented on every successful OpenRouter
  call, reset by date rollover — no cron needed if the check is "count rows where date = today AND
  model_id = X."
- Before routing to Nemotron or MiniMax (auto or user-selected), check that model's counter against
  a conservative cap:
  - Nemotron: **confirmed 20 RPM / 200 RPD** directly from OpenRouter's model page — use this
    number, it's no longer a secondary-source estimate.
  - MiniMax M2.7: not yet confirmed — check OpenRouter's dashboard/docs for the actual free-tier
    RPD before picking a number; don't assume it matches Nemotron's.
- On cap reached: auto-route silently downgrades to `gpt-oss-120b`; user-selected path shows the
  warning state disabled/grayed with a reason naming which model's quota is exhausted (e.g. "Daily
  Nemotron quota used — falling back to Groq").

## Frontend changes

- [src/pages/PortfolioAI.tsx](../src/pages/PortfolioAI.tsx): add a model toggle near the composer
  offering both opt-in options — e.g. "Use NVIDIA Nemotron 3 Ultra" and "Use MiniMax M2.7", each
  labeled "free, rate-limited, best for complex multi-tool questions" with per-model quota-exhausted
  disabling. Include the chosen preference in the POST body (`fetch(CHAT_URL, ...)` around line 74)
  as `modelPreference: 'auto' | 'nemotron' | 'minimax'`.
- No change needed to the SSE `done` event parsing — it already renders whatever `attribution`
  string the backend sends (`🤖 Response by **X**`), so fallback-to-Groq just shows correctly with
  no frontend logic changes.

## Secrets required

- `OPENROUTER_API_KEY` — new, required only for this path; its absence must not affect the
  Anthropic/Groq paths at all (treat like `ANTHROPIC_API_KEY`'s optionality today).

## Rollout tasks (step by step, for our own tracking)

- [x] 1. Confirm OpenRouter's actual free-tier rate limit for Nemotron 3 Ultra (RPM/RPD) — **done**:
      20 RPM / 200 RPD, confirmed directly from OpenRouter's model page and cross-checked against
      independent trackers.
- [ ] 1a. Confirm OpenRouter's actual free-tier rate limit for MiniMax M2.7 (RPM/RPD) directly from
      OpenRouter's account dashboard or docs at implementation time — not yet checked, don't assume
      it matches Nemotron's numbers.
- [ ] 2. Add `OPENROUTER_API_KEY` as a Supabase secret (not committed; follow the existing
      [key-rotation.md](key-rotation.md) convention). One key covers both models — same OpenRouter
      account.
- [ ] 3. Create `supabase/functions/_shared/providers/openrouter.ts` implementing `LlmProvider`
      (mirror `groq.ts`: same message/tool-call shapes), pointed at
      `https://openrouter.ai/api/v1/chat/completions`, with the model id parameterized rather than
      hardcoded so it can serve either `nvidia/nemotron-3-ultra-550b-a55b:free` or
      `minimax/minimax-m2.7:free`, with OpenRouter's recommended `HTTP-Referer` / `X-Title` headers
      set. Note MiniMax supports `response_format` JSON-schema structured output where Nemotron
      doesn't — keep tool-result parsing tolerant enough to work either way.
- [ ] 4. Add a quota-tracking mechanism (Supabase table or KV row), **keyed per model id**, for
      OpenRouter calls per day, plus a small helper (e.g. `_shared/openrouter-quota.ts`) to
      check/increment it per model.
- [ ] 5. Extend `router.ts` (or add a sibling function) so `isComplexQuery`/`shouldEscalate` results
      can route to the configured default OpenRouter model when its quota allows, falling back to
      the existing `gpt-oss-120b` tier otherwise — keep the Groq-only tiering behavior fully intact
      when neither OpenRouter model is in play.
- [ ] 6. Update `buildProvider()` / the turn loop in `supabase/functions/portfolio-ai/index.ts` to:
      accept `modelPreference: 'auto' | 'nemotron' | 'minimax'` from the request body, wire in the
      OpenRouter branch for whichever model id is selected, and catch OpenRouter `HttpCallError`
      (429/5xx) to retry on Groq with an honest `attribution` string.
- [ ] 7. Add structured logging (via `_shared/logger.ts`, not raw `console.log`) for: which
      OpenRouter model was selected (user vs auto), quota check result per model, and any
      fallback-to-Groq event — so this is diagnosable from Supabase's log explorer per
      [logging-monitoring.md](logging-monitoring.md).
- [ ] 8. Add the model-selector UI + warning copy to `src/pages/PortfolioAI.tsx` for both Nemotron
      and MiniMax, threading `modelPreference` into the existing `fetch(CHAT_URL, ...)` call.
- [ ] 9. **Bench-off**: before picking the auto-escalation default, run a handful of real
      multi-tool-call portfolio questions (e.g. stress-test + exposure + benchmark-compare in one
      turn) through Nemotron and MiniMax side by side; compare tool-call correctness, latency, and
      whether MiniMax's `response_format` support actually reduces parsing issues in practice. Record
      the outcome and the chosen default in this doc.
- [ ] 10. Tests (per repo convention — every branch adds/updates tests):
      - `openrouter.ts` provider unit tests mirroring the existing Groq provider tests, covering
        both model ids.
      - `portfolio-ai/index.ts` tests: user-selected Nemotron happy path, user-selected MiniMax
        happy path, quota-exhausted (per model) → auto-fallback to Groq, auto-escalation-by-
        complexity → default OpenRouter model when quota allows.
      - Frontend test for the new toggle (both options) rendering the warning and passing
        `modelPreference` through, alongside the existing `portfolio-ai-tool-trace.test.tsx`
        patterns.
- [ ] 11. Update `README.md` / [llm-mcp-agent-plan.md](llm-mcp-agent-plan.md) cross-reference and
      this doc's Status line once shipped, matching how the MCP agent plan documents its own
      "Shipped" status and PR link.
- [ ] 12. Open PR from a feature branch into `main`; merge only after Vitest, typecheck, and
      Gitleaks all pass (per `CLAUDE.md`'s enforced workflow).

## Explicitly out of scope for this change

- No change to Anthropic path or its trigger condition (`ANTHROPIC_API_KEY` still wins outright).
- No replacing Groq as the default — Nemotron and MiniMax are opt-in or conditional-auto only.
- No client-side (browser) call to OpenRouter — stays server-side in the edge function like the
  other providers, so the API key never reaches the browser.
- No third/fourth distinct provider file — Nemotron and MiniMax are both served through the same
  `providers/openrouter.ts`, differing only by model id and quota-counter key.
