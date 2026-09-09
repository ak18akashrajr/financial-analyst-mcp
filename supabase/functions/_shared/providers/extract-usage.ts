// Shared by groq.ts and openrouter.ts — both are OpenAI-compatible chat
// completions APIs and report token usage in the same `usage: {prompt_tokens,
// completion_tokens}` shape (when they report it at all; see the doc comment
// below).
import type { TurnUsage } from "./types.ts";

/** Returns undefined (not a zeroed TurnUsage) when the response carried no
 * usage field, or an incomplete/wrongly-typed one — observed on some
 * OpenRouter free-tier responses (see openrouter.ts's provider doc comment).
 * Undefined here means "the provider didn't tell us", distinct from a real
 * TurnUsage of {promptTokens: 0, completionTokens: 0}. */
export function extractUsage(usage: unknown): TurnUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const { prompt_tokens, completion_tokens } = usage as Record<string, unknown>;
  if (typeof prompt_tokens !== "number" || typeof completion_tokens !== "number") return undefined;
  return { promptTokens: prompt_tokens, completionTokens: completion_tokens };
}
