import { describe, expect, it } from "vitest";
import { extractUsage } from "./extract-usage.ts";

describe("extractUsage", () => {
  it("maps a well-formed OpenAI-compatible usage object", () => {
    expect(extractUsage({ prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 })).toEqual({
      promptTokens: 120,
      completionTokens: 45,
    });
  });

  it("returns undefined (not a zeroed usage) when usage is missing entirely", () => {
    expect(extractUsage(undefined)).toBeUndefined();
  });

  it("returns undefined when usage is null — observed on some OpenRouter free-tier responses", () => {
    expect(extractUsage(null)).toBeUndefined();
  });

  it("returns undefined when a token count is missing or wrongly typed", () => {
    expect(extractUsage({ prompt_tokens: 120 })).toBeUndefined();
    expect(extractUsage({ prompt_tokens: "120", completion_tokens: 45 })).toBeUndefined();
  });

  it("returns undefined for a non-object value", () => {
    expect(extractUsage("nonsense")).toBeUndefined();
    expect(extractUsage(42)).toBeUndefined();
  });
});
