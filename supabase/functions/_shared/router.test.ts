import { describe, expect, it } from "vitest";
import { explainComplexity, isComplexQuery, shouldEscalate } from "./router.ts";

describe("isComplexQuery", () => {
  it("routes plain lookups to the simple tier", () => {
    expect(isComplexQuery("What's my portfolio value?")).toBe(false);
    expect(isComplexQuery("show my holdings")).toBe(false);
    expect(isComplexQuery("waht is my cash balance")).toBe(false); // typo, still simple
  });

  it("routes known complex keywords to the complex tier", () => {
    expect(isComplexQuery("Can you run a stress test on my portfolio?")).toBe(true);
    expect(isComplexQuery("What if the market crashes 20%?")).toBe(true);
    expect(isComplexQuery("Compare my returns to the benchmark")).toBe(true);
    expect(isComplexQuery("What's my portfolio beta?")).toBe(true);
    expect(isComplexQuery("Am I breaching any limits?")).toBe(true);
  });

  it("routes multi-part questions to the complex tier", () => {
    expect(isComplexQuery("What's my P&L? And what's my cash balance?")).toBe(true);
    expect(isComplexQuery("What's my exposure and how has it drifted?")).toBe(true);
  });
});

describe("explainComplexity", () => {
  it("reports no reason for a plain lookup", () => {
    expect(explainComplexity("What's my portfolio value?")).toEqual({ complex: false, reason: null });
  });

  it("names the matched keyword for a known complex phrase", () => {
    expect(explainComplexity("Can you run a stress test on my portfolio?")).toEqual({
      complex: true,
      reason: 'keyword: "stress test"',
    });
  });

  it("names the question-mark-count rule for a multi-part question", () => {
    expect(explainComplexity("What's my P&L? And what's my cash balance?")).toEqual({
      complex: true,
      reason: "multiple_question_marks: 2",
    });
  });

  it("names the 'and' + question rule when only one question mark is present and no keyword matches", () => {
    expect(explainComplexity("What's my P&L and what's my cash balance?")).toEqual({
      complex: true,
      reason: "and_with_question",
    });
  });

  it("stays consistent with isComplexQuery's boolean verdict", () => {
    const messages = [
      "show my holdings",
      "Can you run a stress test on my portfolio?",
      "What's my P&L? And what's my cash balance?",
    ];
    for (const message of messages) {
      expect(explainComplexity(message).complex).toBe(isComplexQuery(message));
    }
  });
});

describe("shouldEscalate", () => {
  it("does not escalate for a couple of simple tool calls", () => {
    expect(shouldEscalate(1, false)).toBe(false);
    expect(shouldEscalate(2, false)).toBe(false);
  });

  it("escalates once more than 2 tool calls are needed", () => {
    expect(shouldEscalate(3, false)).toBe(true);
  });

  it("escalates immediately when a complex tool is invoked", () => {
    expect(shouldEscalate(1, true)).toBe(true);
  });
});
