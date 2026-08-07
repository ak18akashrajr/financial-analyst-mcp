import { describe, expect, it } from "vitest";
import { isComplexQuery, shouldEscalate } from "./router.ts";

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
