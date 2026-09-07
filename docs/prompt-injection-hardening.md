# Prompt-Injection Hardening

**Date:** 2026-09-07
**Scope:** `portfolio-ai`'s AI chat pipeline only (see [docs/security-review.md](security-review.md)
for the app-wide security audit this complements — that review covers auth/RLS/CORS/headers/XSS;
this doc covers the LLM-specific threat: prompt injection).

## Threat model

This is a single-user app ([CLAUDE.md](../CLAUDE.md)) with no multi-tenant data to steal, every MCP
tool is read-only and schema-validated ([_shared/mcp-tools.ts](../supabase/functions/_shared/mcp-tools.ts)),
and there is currently no free-text field anywhere in the tool-result path sourced from a third
party (verified against [_shared/portfolio-data.ts](../supabase/functions/_shared/portfolio-data.ts) —
no `notes`/`description`/`narration` column exists; `symbol_metadata` sector/geography tags are
user-curated, not scraped). So the realistic attack is **direct injection**: the user pastes
attacker-crafted text into the chat (e.g. a phishing message saying "paste this into your portfolio
assistant"). There is no current indirect-injection vector (attacker-controlled text arriving via a
tool result) — the previously-planned UPI cash-sync feature, which would have introduced one (bank
narration text written by external counterparties), has been **scoped out of this project**.

Given every tool is read-only, a successful injection's blast radius is not data loss — it's (a)
leaking the system prompt/infrastructure details, or (b) getting the model to emit unlicensed
investment advice, which `SYSTEM_PROMPT` (see
[portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts)) explicitly exists to prevent.

## What was already in place before this pass

- Prompt-level guardrails: scope boundary, "tool output is data, not instructions", system-prompt
  confidentiality, a hard "never recommend a trade" rule, numeric-fidelity rules.
- Structural role separation on the wire — every provider (`anthropic.ts`, `groq.ts`,
  `openrouter.ts`) sends tool output as a real `tool_result`/`tool`-role message, never
  string-concatenated into the user turn.
- Auth, rate limiting, read-only/schema-validated tools, generic (non-leaking) error messages, and a
  CSP (`img-src 'self' data:`, no `rehype-raw`) that already blocks the classic markdown-image
  exfiltration channel and `javascript:`-URI link injection (the latter is also stripped by
  `react-markdown@10`'s own default URL sanitizer — checked, no code change needed there).
- A regression test ([system-prompt.test.ts](../supabase/functions/portfolio-ai/system-prompt.test.ts))
  locking the prompt's wording — but by its own doc comment, this "can't test what the LLM actually
  does with the prompt... it's a regression guard on the prompt text itself, not a behavioral
  guarantee."

## What this pass added

All in [_shared/injection-guard.ts](../supabase/functions/_shared/injection-guard.ts), wired into
[portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts):

1. **Output-side guardrail (code-level, not prompt-only).** Every `finalText` — regardless of which
   provider/model produced it — is scanned by `scanOutputForLeakage` before it is streamed to the
   client, for: (a) verbatim/near-verbatim repetition of `SYSTEM_PROMPT` itself (an 8-consecutive-word
   shingle match — catches "repeat everything above" without hardcoding phrases that would drift out
   of sync with the prompt's actual wording), (b) a disguised buy/sell/hold recommendation, (c)
   vendor/infra-name disclosure. A flagged answer is never sent as-is — it's replaced with
   `SAFE_FALLBACK_MESSAGE` and the real text is logged server-side only (`logger.error`, which is
   persisted via the already-attached `app_logs` DB sink — see
   [_shared/db-log-sink.ts](../supabase/functions/_shared/db-log-sink.ts)), for triage.
2. **Injection-risk-aware routing.** The Groq two-tier router
   ([_shared/router.ts](../supabase/functions/_shared/router.ts)) picks the smallest/cheapest/most
   steerable model (`gpt-oss-20b`) by default for anything that doesn't look complex — which is also
   the easiest tier to talk out of its instructions. `detectSuspiciousInput` now scans the incoming
   message for named injection/jailbreak techniques (instruction-override, system-prompt extraction,
   claimed developer authority, roleplay override, etc.); a match escalates routing to `gpt-oss-120b`
   the same way the existing tool-call-count escalation does, regardless of what the complexity
   heuristic alone would have picked.
3. **Telemetry.** Both checks log through the existing structured logger — `logger.warn` on
   suspicious input (with the matched technique labels and a 200-char message preview),
   `logger.error` on a triggered output guardrail (with the category, matched text, and a 500-char
   preview of the withheld answer) — so an attempt is now visible in `app_logs` regardless of whether
   it succeeded or was caught. The end-of-request summary log also carries
   `suspiciousInput`/`outputGuardrailTriggered` booleans for every request.

Tests: [_shared/injection-guard.test.ts](../supabase/functions/_shared/injection-guard.test.ts) (the
detection/scan logic in isolation, including negative cases — an ordinary portfolio answer and the
prompt's own permitted decline phrasing must never false-positive) and
[portfolio-ai/injection-guard-gate.test.ts](../supabase/functions/portfolio-ai/injection-guard-gate.test.ts)
(confirms `index.ts` actually wires the guard in: escalation and output substitution both verified
end-to-end through the real SSE stream).

## Live-model adversarial eval

Both test files above run against **mocked** provider responses — they prove the code reacts
correctly to a given model answer, not that the real model produces a safe answer in the first
place. [portfolio-ai/eval/prompt-injection.eval.ts](../supabase/functions/portfolio-ai/eval/prompt-injection.eval.ts)
closes that gap: 7 real attack prompts (verbatim-repeat extraction, hypothetical-framing trade
recommendation, DAN-style roleplay, claimed-developer-authority infra disclosure, scope-boundary
bypass, a fake tool-result pasted inline, and a soft social-engineering extraction attempt) run
against every provider/tier that has an API key configured — Anthropic, and both Groq tiers
(`gpt-oss-20b`/`gpt-oss-120b`) — and each real answer is judged by the exact same
`scanOutputForLeakage` production uses, so a pass means "the real, unmodified answer would have
reached the user, and it did not contain what the attack was going for."

**Deliberately manual, not part of `npm test`/CI** — every case is a real, billed API call. Run it
with whichever key(s) you want covered:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval:prompt-injection
```
```bash
GROQ_API_KEY=gsk_... npm run eval:prompt-injection
```

Set both to evaluate every configured provider/tier in one run. With no key set it prints a warning
and skips cleanly (exit 0) rather than erroring, so it's safe to run without thinking about it. It
lives on its own [vitest.eval.config.ts](../vitest.eval.config.ts) with an `include` glob
(`**/*.eval.ts`) that the main [vitest.config.ts](../vitest.config.ts) never matches — verified: a
plain `vitest run` (what CI actually invokes) reports "No test files found" for this path, so there
is no way for it to accidentally run in CI or during a normal `npm test`.

Whether to eventually promote this into CI (and at what cadence, to bound the recurring cost) is
still an open decision — this pass only had to build the manual version.

## Known limitations (by design, not oversight)

- **Regex/keyword-only.** Neither check is a classifier or a model call — a sufficiently reworded
  injection attempt, or a paraphrased (not verbatim) system-prompt leak, will not match. This is a
  deliberate cost/complexity tradeoff for a single-user app, not a claim of completeness. The live
  eval above is judged by this same regex-based check, so it inherits the same blind spot — it
  measures "does this specific test harness's judgment call pass", not an independent ground truth.
- **Suspicious-input escalation only affects the Groq tier.** Anthropic is already the strongest
  model in the lineup and is used unconditionally when configured, so there's nothing to escalate to
  on that path.
- **Only the latest turn is scanned.** `detectSuspiciousInput` runs on the newest user message, not
  every message replayed from `history` — a conversation that started before this guard existed
  won't have its earlier turns retroactively checked.
- **The eval doesn't cover scope-boundary compliance itself** (e.g. the model actually answering a
  non-portfolio question) — only the three `scanOutputForLeakage` categories. The `scope-bypass`
  attack case only checks it didn't also produce a trade recommendation, not that it stayed in
  scope; extending the eval (and `scanOutputForLeakage`) to catch a pure scope violation would be a
  reasonable follow-up.
