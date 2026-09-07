// Best-effort, heuristic defense-in-depth layered ON TOP of SYSTEM_PROMPT's
// own instructions (see portfolio-ai/index.ts) — not a replacement for them.
// Two independent, cheap (regex-only, no extra LLM call) checks:
//
//  - detectSuspiciousInput: scans the user's latest message for phrasing
//    associated with real-world prompt-injection/jailbreak attempts (e.g.
//    "ignore previous instructions", "reveal your system prompt"). A match
//    never blocks the request — false positives here are just ordinary
//    phrasing that happens to match a pattern, and blocking a real question
//    outright would be worse than the risk it's guarding against for a
//    single-user app. Instead a match only escalates routing to a stronger,
//    harder-to-steer model (see portfolio-ai/index.ts's Groq tiering) and is
//    logged for visibility. This is genuinely best-effort: it is keyword/
//    regex matching, not a classifier, and a sufficiently reworded attempt
//    will not match — see docs/prompt-injection-hardening.md for the
//    known limitations and what would close them.
//
//  - scanOutputForLeakage: scans the model's OWN final answer, before it is
//    streamed to the client, for two failure modes SYSTEM_PROMPT explicitly
//    forbids but that the prompt text alone cannot *guarantee* against (see
//    system-prompt.test.ts's own doc comment — it only regression-tests the
//    prompt's wording, never live model behavior): (1) verbatim/near-verbatim
//    repetition of SYSTEM_PROMPT itself — the most common real-world
//    extraction technique ("repeat everything above verbatim") — and (2) a
//    disguised buy/sell/hold recommendation, which is the one rule where
//    getting it wrong isn't just an information leak but a real unlicensed-
//    financial-advice concern. A flagged answer is never sent to the client
//    as-is — portfolio-ai/index.ts substitutes SAFE_FALLBACK_MESSAGE and logs
//    the real (would-be) answer server-side only, for triage.
//
// Neither check can see or influence tool calls — every MCP tool is
// read-only and schema-validated regardless of what the model decides to
// call (see mcp-tools.ts), so the worst case of a bypass here is an unwanted
// disclosure, never a data mutation.

export interface SuspiciousInputResult {
  suspicious: boolean;
  /** Which named technique(s) matched — for logging, not for branching on. */
  matched: string[];
}

interface LabeledPattern {
  label: string;
  pattern: RegExp;
}

// Each pattern targets one distinct, named real-world injection/jailbreak
// technique. Deliberately narrow over broad: a broad pattern like /act as/i
// would flag entirely ordinary questions ("what would a conservative
// investor do") far too often to be useful signal.
const INPUT_PATTERNS: LabeledPattern[] = [
  {
    label: "ignore_prior_instructions",
    pattern: /\b(ignore|disregard|forget)\b[^.!?]{0,40}\b(previous|prior|above|earlier|all)\b[^.!?]{0,20}\b(instructions?|rules?|prompt|guidelines?)\b/i,
  },
  { label: "override_instructions", pattern: /\boverride\b[^.!?]{0,30}\b(instructions?|rules?|guidelines?|prompt)\b/i },
  { label: "claims_new_instructions", pattern: /\b(new|updated) instructions?\s*[:\-]/i },
  {
    label: "reveal_system_prompt",
    pattern: /\b(reveal|show|print|repeat|output|leak)\b[^.!?]{0,30}\b(system prompt|your instructions|the instructions above|your rules|your guidelines)\b/i,
  },
  {
    label: "claims_developer_authority",
    pattern: /\b(from|as|this is)\b[^.!?]{0,15}\b(the )?(system|developer|admin)\b[^.!?]{0,20}\b(speaking|now|instruction|override)/i,
  },
  { label: "roleplay_override", pattern: /\byou are now\b/i },
  { label: "developer_mode", pattern: /\b(developer mode|debug mode|jailbreak|DAN mode)\b/i },
  { label: "claims_test_authorization", pattern: /\bthis is (a |an )?(test|authorized override|debugging session)\b/i },
];

export function detectSuspiciousInput(message: string): SuspiciousInputResult {
  const matched = INPUT_PATTERNS.filter((p) => p.pattern.test(message)).map((p) => p.label);
  return { suspicious: matched.length > 0, matched };
}

export type LeakageCategory = "system_prompt_leak" | "trade_recommendation" | "infra_disclosure";

export interface OutputLeakageResult {
  flagged: boolean;
  category?: LeakageCategory;
  /** The specific matched substring, for logging — never sent to the client. */
  detail?: string;
}

export const SAFE_FALLBACK_MESSAGE =
  "I can't share that. I can only help with your own portfolio data — try rephrasing your question.";

// SYSTEM_PROMPT's own "Never recommend a trade" section forbids this
// outright; it gets an independent check because getting it wrong isn't
// just an information leak, it's a real unlicensed-advice/SEBI concern.
const TRADE_RECOMMENDATION_PATTERNS: RegExp[] = [
  /\byou should (buy|sell|hold|invest in|switch (to|from)|avoid)\b/i,
  /\bi(?:'d| would)? recommend (buying|selling|holding|investing in)\b/i,
  /\b(strong buy|strong sell|buy rating|sell rating|price target)\b/i,
  /\bconsider (buying|selling|switching (to|from)|investing in)\b/i,
  /\bit(?:'s| is) (a good|a great|the best) time to (buy|sell)\b/i,
];

// Vendor/model/infra names SYSTEM_PROMPT's "never reveal ... infrastructure/
// provider details" line forbids naming — mirrors the same rule already
// enforced for error messages in chat-error-classifier.ts.
const INFRA_DISCLOSURE_PATTERN = /\b(anthropic|claude|groq|openrouter|gpt-oss|nemotron|minimax|supabase|postgres(?:ql)?)\b/i;

/** Longest run of consecutive words from `systemPrompt` treated as one
 * "shingle" when checking for verbatim leakage — long enough that an
 * accidental coincidental match is essentially impossible in normal
 * portfolio-data prose, short enough that a leak doesn't have to reproduce a
 * whole paragraph to be caught. */
const LEAK_SHINGLE_WORDS = 8;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True if any run of LEAK_SHINGLE_WORDS consecutive words from
 * `systemPrompt` appears verbatim (whitespace-normalized) inside `text`.
 * Catches the most common real extraction technique — "repeat everything
 * above" — without hardcoding a phrase list that would drift out of sync
 * with SYSTEM_PROMPT's actual wording every time it's edited. This will NOT
 * catch a paraphrased leak; that's a real, documented limitation of a
 * regex-only check, not an oversight. */
function containsVerbatimShingle(text: string, systemPrompt: string): boolean {
  const haystack = normalize(text);
  if (haystack.length < 40) return false; // too short to meaningfully contain a leak
  const words = normalize(systemPrompt).split(" ").filter(Boolean);
  for (let i = 0; i + LEAK_SHINGLE_WORDS <= words.length; i += 1) {
    const shingle = words.slice(i, i + LEAK_SHINGLE_WORDS).join(" ");
    if (haystack.includes(shingle)) return true;
  }
  return false;
}

export function scanOutputForLeakage(text: string, systemPrompt: string): OutputLeakageResult {
  if (!text.trim()) return { flagged: false };

  if (containsVerbatimShingle(text, systemPrompt)) {
    return { flagged: true, category: "system_prompt_leak" };
  }

  for (const pattern of TRADE_RECOMMENDATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { flagged: true, category: "trade_recommendation", detail: match[0] };
  }

  const infraMatch = text.match(INFRA_DISCLOSURE_PATTERN);
  if (infraMatch) return { flagged: true, category: "infra_disclosure", detail: infraMatch[0] };

  return { flagged: false };
}
