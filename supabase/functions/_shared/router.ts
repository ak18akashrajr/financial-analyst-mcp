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

export interface ComplexityVerdict {
  complex: boolean;
  /**
   * Which rule fired, so a routing decision is explainable after the fact
   * instead of only showing which model got picked — see portfolio-ai/
   * index.ts's "Chat request started" log line. Null when `complex` is
   * false (nothing fired) or "not complex" isn't a decision that needs
   * explaining.
   */
  reason: string | null;
}

/**
 * Same heuristic as isComplexQuery, but reports which rule matched instead
 * of collapsing straight to a boolean — isComplexQuery is kept as a thin
 * wrapper around this so its existing boolean-returning callers/tests are
 * unaffected.
 */
export function explainComplexity(message: string): ComplexityVerdict {
  const lower = message.toLowerCase();
  const matchedKeyword = COMPLEXITY_KEYWORDS.find((k) => lower.includes(k));
  if (matchedKeyword) return { complex: true, reason: `keyword: "${matchedKeyword}"` };

  // Multi-part questions (contains " and " combined with a question, or multiple "?")
  const questionMarks = (lower.match(/\?/g) || []).length;
  if (questionMarks > 1) return { complex: true, reason: `multiple_question_marks: ${questionMarks}` };
  if (lower.includes(" and ") && lower.includes("?")) return { complex: true, reason: "and_with_question" };

  return { complex: false, reason: null };
}

/** True if the message looks complex enough to warrant the bigger model up front. */
export function isComplexQuery(message: string): boolean {
  return explainComplexity(message).complex;
}

export const GROQ_SIMPLE_MODEL = "openai/gpt-oss-20b";
export const GROQ_COMPLEX_MODEL = "openai/gpt-oss-120b";

/** Escalation trigger: too many tool calls needed, or a tool tagged "complex" was invoked. */
export function shouldEscalate(toolCallCount: number, invokedComplexTool: boolean): boolean {
  return toolCallCount > 2 || invokedComplexTool;
}
