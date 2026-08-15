# Portfolio AI: Real MCP + Multi-Provider Agent — Migration Plan

Status: **Shipped** — merged via [PR #3](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/3) from `feature/claude-mcp-agent`. Kept here as the architecture record for the MCP server + provider routing.

## Why

The current `portfolio-ai` Supabase Edge Function calls Gemini (via Lovable AI Gateway) with a
Groq/LLaMA fallback, both via raw `fetch`. All "tools" (`get_portfolio_summary`, `run_stress_test`,
etc.) are prose in the system prompt — the model narrates pretending to call them, but no real
tool-calling or MCP protocol exists anywhere in the repo. Two of the referenced Groq models
(`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`) are deprecated by Groq with shutdown on
**2026-08-16**, so this also fixes an imminent breakage.

## Goals

1. Replace prose-pretend tools with a **real MCP server** exposing actual portfolio tools over the
   Model Context Protocol — makes the "MCP" in the product's name true, not cosmetic.
2. Run on **Groq (`openai/gpt-oss-120b`) as the primary/default provider today** (no Anthropic key
   required yet), with **Claude Sonnet 5 as an env-var swap-in** the moment an `ANTHROPIC_API_KEY`
   is available — no rewrite needed to upgrade later.
3. Add **two-tier Groq routing** (`gpt-oss-20b` for simple queries, `gpt-oss-120b` for complex ones)
   for token/cost optimization, with an escalation safety net so misrouted complex queries still
   get a correct answer.
4. Rely on the model's native language understanding for typo tolerance — no bespoke
   spellcheck/NLU layer needed for conversational input.

## Target architecture

```
Browser (src/pages/PortfolioAI.tsx)
      │  SSE chat request
      ▼
Edge Function: portfolio-ai  (rebuilt)
      │  1. tools/list → MCP client discovers available tools
      │  2. Router: heuristic classifies request as simple/complex (Groq path only)
      │  3. Calls provider (Groq gpt-oss-20b/120b, or Claude Sonnet 5 if
      │     ANTHROPIC_API_KEY is set) with tools + streaming
      │  4. On tool_use → dispatches via MCP client → tools/call
      │  5. Feeds tool_result back to the model, loops until final answer
      │  6. Escalates gpt-oss-20b → gpt-oss-120b if >2 tool calls, a
      │     "complex"-tagged tool is invoked, or the model hedges
      │  7. Streams final text + tool-call status events back to the browser
      ▼
Edge Function: portfolio-mcp-server  (new)
      │  Real MCP server (Streamable HTTP transport). Tools:
      │  get_portfolio_summary, list_holdings, get_exposure_by_geography,
      │  get_exposure_by_category, get_concentration_risk, get_risk_metrics,
      │  run_stress_test, check_limit_breaches, compare_to_benchmark,
      │  get_exposure_drift — each backed by a real SQL query, not a
      │  single context dump.
      ▼
Supabase Postgres: transactions, cash_settings, current_prices,
symbol_metadata, historical_prices, benchmark_history, net_worth_history
```

## Provider selection

| Provider | Model | Role | Trigger |
|---|---|---|---|
| Groq | `openai/gpt-oss-20b` | Cheap/fast tier | Default for heuristically "simple" queries |
| Groq | `openai/gpt-oss-120b` | Capability tier | Complex queries, or escalated from gpt-oss-20b |
| Anthropic | `claude-sonnet-5` | Full replacement | Used instead of Groq entirely once `ANTHROPIC_API_KEY` env var is set |

`groq/compound` and `compound-mini` were evaluated and rejected — they don't support custom
tool definitions, which rules out wiring in our MCP tools at all.

## Two-tier routing design

1. **Free heuristic pre-routing** (no extra LLM call): route to `gpt-oss-20b` by default; route
   directly to `gpt-oss-120b` if the message matches complexity signals (keywords like "stress
   test", "scenario", "what if", "simulate", "compare", "risk exposure", or multi-part questions).
2. **Escalation safety net**: if a `gpt-oss-20b` turn needs more than ~2 tool calls, invokes a
   tool tagged `complex` in the MCP tool registry, or returns a hedging/low-confidence answer,
   abort and retry the turn on `gpt-oss-120b` instead of returning a weak answer.
3. **Visibility**: log which tier served each request (model, tool-call count, escalated y/n) to
   tune the keyword list from real usage data later.

This tiering applies to the Groq path only; the Claude path is single-model for now.

## Rollout phases (this branch)

1. Write this plan doc. ✅ (this file)
2. Build the real MCP server edge function (`supabase/functions/portfolio-mcp-server`).
3. Rebuild `portfolio-ai`: provider abstraction + tool-use loop + router, replacing the
   Gemini/Groq raw-fetch code.
4. Update `src/pages/PortfolioAI.tsx`'s SSE parser and tool-call status UI.
5. Remove dead Lovable/Gemini code and secrets; update `README.md`.
6. Tests: unit tests for the tool-dispatch loop and router heuristic, an integration check against
   the MCP server directly, and manual QA with intentionally typo'd prompts.
7. Open PR from `feature/claude-mcp-agent` into `main`; merge only after the required Gitleaks
   check passes and manual review.

## Secrets required

- `GROQ_API_KEY` — required (primary provider today).
- `ANTHROPIC_API_KEY` — optional; when present, the agent uses Claude Sonnet 5 instead of Groq.
- `LOVABLE_API_KEY` and the old Gemini/Groq-fallback code path are removed as part of this work.

## Explicitly out of scope for this change

- No bespoke typo-correction/NLU layer — relying on the model's native robustness.
- No dedicated classifier LLM call for routing — heuristic + escalation only, to avoid adding
  cost/latency to every request.
- No changes to auth/login gating (`src/components/LoginGate.tsx`) or unrelated pages.
