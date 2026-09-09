import { describe, expect, it } from "vitest";
import { estimateCostUsd, isKnownFreeModel } from "./pricing.ts";

describe("isKnownFreeModel", () => {
  it("is true for OpenRouter's free-tier model id suffix", () => {
    expect(isKnownFreeModel("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(true);
    expect(isKnownFreeModel("minimax/minimax-m2.7:free")).toBe(true);
  });

  it("is false for a Groq model id", () => {
    expect(isKnownFreeModel("openai/gpt-oss-20b")).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  it("computes cost from Groq's published per-million-token rates", () => {
    // 1,000,000 prompt + 1,000,000 completion tokens on gpt-oss-20b:
    // $0.075 input + $0.30 output = $0.375.
    expect(estimateCostUsd("openai/gpt-oss-20b", 1_000_000, 1_000_000)).toBeCloseTo(0.375, 6);
  });

  it("scales linearly with token count", () => {
    // 1,500 prompt + 300 completion tokens on gpt-oss-120b ($0.15 / $0.60 per 1M).
    const expected = (1500 / 1_000_000) * 0.15 + (300 / 1_000_000) * 0.60;
    expect(estimateCostUsd("openai/gpt-oss-120b", 1500, 300)).toBeCloseTo(expected, 10);
  });

  it("returns null (not 0) for a model with no entry in the pricing table", () => {
    expect(estimateCostUsd("nvidia/nemotron-3-ultra-550b-a55b:free", 1000, 1000)).toBeNull();
    expect(estimateCostUsd("some/unknown-model", 1000, 1000)).toBeNull();
  });
});
