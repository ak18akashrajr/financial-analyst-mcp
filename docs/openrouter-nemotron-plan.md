# Portfolio AI: OpenRouter (Nemotron 3 Ultra) as Third Provider — Plan

Status: **Not started** — documented for later implementation, tracked here so both of us can pick
it up. Companion to [llm-mcp-agent-plan.md](llm-mcp-agent-plan.md), which this extends rather than
replaces.

## Why

Groq (`gpt-oss-20b`/`gpt-oss-120b`) is the default provider; Claude Sonnet 5 replaces it entirely
once `ANTHROPIC_API_KEY` is set (not available yet — out of scope for this change). NVIDIA's
Nemotron 3 Ultra (550B total / 55B active MoE), free on OpenRouter, is verified to fit our tool-use
agent loop and is strong specifically at the agentic/tool-calling workload this app needs:

- Accepts `tools`/`tool_choice` in an OpenAI-compatible chat-completions format — same shape our
  `LlmProvider` interface and `groq.ts` already use.
- Competitive with GPT-4o on BFCL and τ-bench (tool-calling/agentic benchmarks); beats
  trillion-parameter models on ProfBench, per NVIDIA's own benchmarks.
- 1M token context window, up to 65,536 completion tokens — well beyond `gpt-oss-20b`/`120b`,
  useful for queries whose tool-result JSON (holdings, exposure tables, stress-test output) is large.
- **Caveat**: it's free-tier rate-limited on OpenRouter (order of ~20 req/min, low daily cap without
  purchased credits — OpenRouter's own docs don't publish an exact per-model number, so treat any
  specific figure as approximate until confirmed at implementation time). This is why it's wired in
  as an *option and conditional auto-route*, never a default replacement for Groq.

## Goals

1. Add OpenRouter/Nemotron as a **third provider**, additive only — Anthropic-first and
   Groq-default selection in `buildProvider()` stay exactly as they are today.
2. Let the end user **explicitly opt into Nemotron** from the chat UI, with a visible warning about
   the tight free-tier quota, so they choose it deliberately for a question that needs the bigger
   context/tool-reasoning, not by accident.
3. Add an **automatic complexity-based route** to Nemotron for queries the existing heuristic
   already flags as complex (reusing `isComplexQuery`/`shouldEscalate` signals), gated by a daily
   quota counter so auto-routing degrades gracefully to `gpt-oss-120b` instead of erroring once the
   quota's near-exhausted.
4. Whichever path triggers Nemotron, a rate-limit/quota failure must **fall back to Groq**
   transparently (with an honest `attribution` string), never surface a raw 429 to the user.

## Target architecture (delta over llm-mcp-agent-plan.md)

```
Browser (src/pages/PortfolioAI.tsx)
      │  SSE chat request: { messages, modelPreference?: 'auto' | 'nemotron' }
      ▼
Edge Function: portfolio-ai
      │  buildProvider():
      │    1. ANTHROPIC_API_KEY set?        → Claude Sonnet 5 (unchanged, untouched by this work)
      │    2. modelPreference === 'nemotron' → OpenRouterProvider, IF daily quota not exhausted
      │                                        else fall back to Groq + note in attribution
      │    3. else Groq default path:
      │         - router.isComplexQuery() / shouldEscalate() flags complex
      │           AND Nemotron daily quota has headroom
      │           → OpenRouterProvider (auto-escalation target, replacing gpt-oss-120b for this turn)
      │         - else → existing gpt-oss-20b / gpt-oss-120b tiering, unchanged
      │    On any OpenRouter HttpCallError (429/5xx) → retry same turn on Groq gpt-oss-120b,
      │    attribution records the fallback.
      ▼
providers/openrouter.ts (new) — OpenAI-compatible chat-completions client, same LlmProvider shape
as groq.ts. Endpoint: https://openrouter.ai/api/v1/chat/completions
Model id: nvidia/nemotron-3-ultra-550b-a55b:free
```

## Provider selection (updated table)

| Provider | Model | Role | Trigger |
|---|---|---|---|
| Anthropic | `claude-sonnet-5` | Full replacement | `ANTHROPIC_API_KEY` set (unchanged, not available yet) |
| Groq | `openai/gpt-oss-20b` | Cheap/fast tier | Default for heuristically "simple" queries |
| Groq | `openai/gpt-oss-120b` | Capability tier | Complex queries / escalated, or Nemotron fallback target |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` | Opt-in / auto-escalation for complex queries | User explicitly selects it, or auto-route when complex **and** daily quota has headroom |

## Rate-limit / quota strategy

- Track OpenRouter requests-used-today in a small Supabase table (e.g. `llm_quota_usage(date,
  provider, count)`) or a KV-style row, incremented on every successful OpenRouter call, reset by
  date rollover — no cron needed if the check is "count rows where date = today."
- Before routing to Nemotron (auto or user-selected), check the counter against a conservative cap
  (confirm OpenRouter's actual free-tier RPD before picking the number — do not hardcode the
  unconfirmed ~200/day figure from secondary sources without checking OpenRouter's dashboard/docs
  at implementation time).
- On cap reached: auto-route silently downgrades to `gpt-oss-120b`; user-selected path shows the
  warning state disabled/grayed with a reason ("Daily Nemotron quota used — falling back to Groq").

## Frontend changes

- [src/pages/PortfolioAI.tsx](../src/pages/PortfolioAI.tsx): add a model toggle near the composer
  (e.g. "Use NVIDIA Nemotron 3 Ultra — free, rate-limited, best for complex multi-tool questions").
  Include the chosen preference in the POST body (`fetch(CHAT_URL, ...)` around line 74) as
  `modelPreference`.
- No change needed to the SSE `done` event parsing — it already renders whatever `attribution`
  string the backend sends (`🤖 Response by **X**`), so fallback-to-Groq just shows correctly with
  no frontend logic changes.

## Secrets required

- `OPENROUTER_API_KEY` — new, required only for this path; its absence must not affect the
  Anthropic/Groq paths at all (treat like `ANTHROPIC_API_KEY`'s optionality today).

## Rollout tasks (step by step, for our own tracking)

- [ ] 1. Confirm OpenRouter's actual free-tier rate limit for this model (RPM/RPD) directly from
      OpenRouter's account dashboard or docs at implementation time — don't trust the ~20RPM/200RPD
      figure from secondary blogs without checking.
- [ ] 2. Add `OPENROUTER_API_KEY` as a Supabase secret (not committed; follow the existing
      [key-rotation.md](key-rotation.md) convention).
- [ ] 3. Create `supabase/functions/_shared/providers/openrouter.ts` implementing `LlmProvider`
      (mirror `groq.ts`: same message/tool-call shapes), pointed at
      `https://openrouter.ai/api/v1/chat/completions`, model
      `nvidia/nemotron-3-ultra-550b-a55b:free`, with OpenRouter's recommended `HTTP-Referer` /
      `X-Title` headers set.
- [ ] 4. Add a quota-tracking mechanism (Supabase table or KV row) for OpenRouter calls per day,
      plus a small helper (e.g. `_shared/openrouter-quota.ts`) to check/increment it.
- [ ] 5. Extend `router.ts` (or add a sibling function) so `isComplexQuery`/`shouldEscalate` results
      can route to Nemotron when quota allows, falling back to the existing `gpt-oss-120b` tier
      otherwise — keep the Groq-only tiering behavior fully intact when Nemotron isn't in play.
- [ ] 6. Update `buildProvider()` / the turn loop in `supabase/functions/portfolio-ai/index.ts` to:
      accept `modelPreference` from the request body, wire in the OpenRouter branch, and catch
      OpenRouter `HttpCallError` (429/5xx) to retry on Groq with an honest `attribution` string.
- [ ] 7. Add structured logging (via `_shared/logger.ts`, not raw `console.log`) for: Nemotron
      selected (user vs auto), quota check result, and any fallback-to-Groq event — so this is
      diagnosable from Supabase's log explorer per [logging-monitoring.md](logging-monitoring.md).
- [ ] 8. Add the model-selector UI + warning copy to `src/pages/PortfolioAI.tsx`, threading
      `modelPreference` into the existing `fetch(CHAT_URL, ...)` call.
- [ ] 9. Tests (per repo convention — every branch adds/updates tests):
      - `openrouter.ts` provider unit tests mirroring the existing Groq provider tests.
      - `portfolio-ai/index.ts` tests: user-selected Nemotron happy path, quota-exhausted →
        auto-fallback to Groq, auto-escalation-by-complexity → Nemotron when quota allows.
      - Frontend test for the new toggle rendering the warning and passing `modelPreference`
        through, alongside the existing `portfolio-ai-tool-trace.test.tsx` patterns.
- [ ] 10. Update `README.md` / [llm-mcp-agent-plan.md](llm-mcp-agent-plan.md) cross-reference and
      this doc's Status line once shipped, matching how the MCP agent plan documents its own
      "Shipped" status and PR link.
- [ ] 11. Open PR from a feature branch into `main`; merge only after Vitest, typecheck, and
      Gitleaks all pass (per `CLAUDE.md`'s enforced workflow).

## Explicitly out of scope for this change

- No change to Anthropic path or its trigger condition (`ANTHROPIC_API_KEY` still wins outright).
- No replacing Groq as the default — Nemotron is opt-in or conditional-auto only.
- No client-side (browser) call to OpenRouter — stays server-side in the edge function like the
  other providers, so the API key never reaches the browser.
