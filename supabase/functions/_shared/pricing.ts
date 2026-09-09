// Approximate cost per LLM call, computed from the token counts each
// provider's own response reports (see providers/groq.ts's and
// providers/openrouter.ts's `usage` handling). Neither Groq nor OpenRouter
// exposes live per-account billing via API, so PRICING_BY_MODEL below is a
// hardcoded snapshot of their published rates — it WILL drift out of date
// as pricing changes, with no automated way to catch that. Re-check against
// the source below if a cost figure surfaced in DevZone looks implausible.
//
// Groq pricing confirmed 2026-09-09 from https://console.groq.com/docs/models
// (cross-checked against https://www.cloudzero.com/blog/groq-pricing/):
//   openai/gpt-oss-20b:  $0.075 / 1M input tokens, $0.30 / 1M output tokens
//   openai/gpt-oss-120b: $0.15  / 1M input tokens, $0.60 / 1M output tokens
//
// OpenRouter's Nemotron/MiniMax models used here (see
// _shared/openrouter-quota.ts's NEMOTRON_MODEL_ID/MINIMAX_MODEL_ID) are both
// on the free tier — the ":free" model-id suffix is OpenRouter's own
// convention for $0-regardless-of-tokens pricing — so they're deliberately
// absent from PRICING_BY_MODEL; see isKnownFreeModel() below instead of
// adding a $0 entry per model.

export interface PricePerMillionTokens {
  inputUsd: number;
  outputUsd: number;
}

const PRICING_BY_MODEL: Record<string, PricePerMillionTokens> = {
  "openai/gpt-oss-20b": { inputUsd: 0.075, outputUsd: 0.30 },
  "openai/gpt-oss-120b": { inputUsd: 0.15, outputUsd: 0.60 },
};

/** True for a model priced at a real, known $0 regardless of token count
 * (OpenRouter's free tier) — checked before estimateCostUsd() so a free
 * model reads as "$0.00" rather than "unknown", the two being meaningfully
 * different for cost reporting. */
export function isKnownFreeModel(model: string): boolean {
  return model.endsWith(":free");
}

/** Returns null — not zero — for a model with no entry in PRICING_BY_MODEL
 * (e.g. a model added to a provider without this table being updated).
 * Callers should check isKnownFreeModel() first: a null here means
 * "unpriced/unknown", never "free". */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = PRICING_BY_MODEL[model];
  if (!price) return null;
  return (promptTokens / 1_000_000) * price.inputUsd + (completionTokens / 1_000_000) * price.outputUsd;
}
