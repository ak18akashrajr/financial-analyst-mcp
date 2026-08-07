// Zero-cost heuristic router for the Groq two-tier setup (gpt-oss-20b vs
// gpt-oss-120b). No LLM call is spent on classification — it's plain keyword
// matching against the user's latest message, done before any provider call.
// The agent backend's escalation safety net (in portfolio-ai/index.ts)
// handles the cases this heuristic misses.

const COMPLEXITY_KEYWORDS = [
  "stress test",
  "scenario",
  "what if",
  "simulate",
  "simulation",
  "compare",
  "comparison",
  "benchmark",
  "risk exposure",
  "volatility",
  "beta",
  "drift",
  "breach",
  "limit",
  "crash",
  "correlat",
];

/** True if the message looks complex enough to warrant the bigger model up front. */
export function isComplexQuery(message: string): boolean {
  const lower = message.toLowerCase();
  if (COMPLEXITY_KEYWORDS.some((k) => lower.includes(k))) return true;

  // Multi-part questions (contains " and " combined with a question, or multiple "?")
  const questionMarks = (lower.match(/\?/g) || []).length;
  if (questionMarks > 1) return true;
  if (lower.includes(" and ") && lower.includes("?")) return true;

  return false;
}

export const GROQ_SIMPLE_MODEL = "openai/gpt-oss-20b";
export const GROQ_COMPLEX_MODEL = "openai/gpt-oss-120b";

/** Escalation trigger: too many tool calls needed, or a tool tagged "complex" was invoked. */
export function shouldEscalate(toolCallCount: number, invokedComplexTool: boolean): boolean {
  return toolCallCount > 2 || invokedComplexTool;
}
