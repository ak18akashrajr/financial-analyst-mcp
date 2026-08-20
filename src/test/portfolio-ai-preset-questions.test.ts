// Locks in two properties of PortfolioAI's preset question sidebar: every
// preset should be answerable by a real MCP tool call (not left to the model
// reasoning ungrounded), and none should invite the kind of "what should I
// buy/sell" framing portfolio-ai's SYSTEM_PROMPT is instructed to decline
// (see supabase/functions/portfolio-ai/index.ts's "Never recommend a trade"
// section) — a preset shouldn't set the user up for a guardrail refusal.
import { describe, expect, it } from "vitest";
import { PRESET_QUESTIONS } from "@/pages/PortfolioAI";

// Mirrors the recommendation-inviting phrasing SYSTEM_PROMPT is guarded
// against — "suggest", "recommend", "should i" framings.
const RECOMMENDATION_INVITING = /\b(suggest|recommend|should i|what should)\b/i;

describe("PortfolioAI preset questions", () => {
  it("has a non-empty icon, text, and category for every preset", () => {
    expect(PRESET_QUESTIONS.length).toBeGreaterThan(0);
    for (const q of PRESET_QUESTIONS) {
      expect(q.icon).toBeTruthy();
      expect(q.text).toBeTruthy();
      expect(q.cat).toBeTruthy();
    }
  });

  it("never phrases a preset as inviting a buy/sell/rebalance recommendation", () => {
    for (const q of PRESET_QUESTIONS) {
      expect(q.text).not.toMatch(RECOMMENDATION_INVITING);
    }
  });

  it("has no duplicate preset text", () => {
    const texts = PRESET_QUESTIONS.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
