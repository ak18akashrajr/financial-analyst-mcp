import { describe, expect, it } from "vitest";
import { validateArgs } from "./mcp-schema-validate.ts";

const TOP_N_SCHEMA = {
  type: "object",
  properties: { topN: { type: "number", minimum: 1, description: "..." } },
  additionalProperties: false,
};

const SHOCK_SCHEMA = {
  type: "object",
  properties: { shockPercent: { type: "number", description: "..." } },
  required: ["shockPercent"],
  additionalProperties: false,
};

const DATE_SCHEMA = {
  type: "object",
  properties: { asOfDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "..." } },
  required: ["asOfDate"],
  additionalProperties: false,
};

const SYMBOL_SCHEMA = {
  type: "object",
  properties: { benchmarkSymbol: { type: "string", minLength: 1, description: "..." } },
  additionalProperties: false,
};

const SYMBOLS_ARRAY_SCHEMA = {
  type: "object",
  properties: { symbols: { type: "array", items: { type: "string" }, minItems: 1, description: "..." } },
  additionalProperties: false,
};

describe("validateArgs", () => {
  it("accepts an empty object against a no-properties schema", () => {
    expect(validateArgs({ type: "object", properties: {}, additionalProperties: false }, {})).toBeNull();
  });

  it("accepts a present optional numeric argument that satisfies minimum", () => {
    expect(validateArgs(TOP_N_SCHEMA, { topN: 3 })).toBeNull();
  });

  it("accepts an absent optional argument", () => {
    expect(validateArgs(TOP_N_SCHEMA, {})).toBeNull();
  });

  it("rejects a numeric argument below its declared minimum instead of silently clamping", () => {
    const error = validateArgs(TOP_N_SCHEMA, { topN: -3 });
    expect(error).toMatch(/topN.*>= 1/);
  });

  it("rejects a non-numeric value for a number-typed argument", () => {
    const error = validateArgs(TOP_N_SCHEMA, { topN: "five" });
    expect(error).toMatch(/topN.*must be a number/);
  });

  it("rejects NaN/Infinity for a number-typed argument", () => {
    expect(validateArgs(TOP_N_SCHEMA, { topN: NaN })).toMatch(/must be a number/);
    expect(validateArgs(TOP_N_SCHEMA, { topN: Infinity })).toMatch(/must be a number/);
  });

  it("rejects a missing required argument", () => {
    const error = validateArgs(SHOCK_SCHEMA, {});
    expect(error).toMatch(/Missing required argument: shockPercent/);
  });

  it("accepts a valid required argument", () => {
    expect(validateArgs(SHOCK_SCHEMA, { shockPercent: -20 })).toBeNull();
  });

  it("rejects unexpected extra properties when additionalProperties is false", () => {
    const error = validateArgs(SHOCK_SCHEMA, { shockPercent: -20, extra: "nope" });
    expect(error).toMatch(/Unexpected argument\(s\): extra/);
  });

  it("rejects a string that doesn't match the declared pattern", () => {
    const error = validateArgs(DATE_SCHEMA, { asOfDate: "not-a-date" });
    expect(error).toMatch(/asOfDate.*does not match required format/);
  });

  it("accepts a string that matches the declared pattern", () => {
    expect(validateArgs(DATE_SCHEMA, { asOfDate: "2026-01-01" })).toBeNull();
  });

  it("rejects a string shorter than minLength", () => {
    const error = validateArgs(SYMBOL_SCHEMA, { benchmarkSymbol: "" });
    expect(error).toMatch(/benchmarkSymbol.*at least 1 character/);
  });

  it("accepts a valid array of strings", () => {
    expect(validateArgs(SYMBOLS_ARRAY_SCHEMA, { symbols: ["TCS", "HDFC"] })).toBeNull();
  });

  it("accepts an absent optional array argument", () => {
    expect(validateArgs(SYMBOLS_ARRAY_SCHEMA, {})).toBeNull();
  });

  it("rejects a non-array value for an array-typed argument", () => {
    const error = validateArgs(SYMBOLS_ARRAY_SCHEMA, { symbols: "TCS" });
    expect(error).toMatch(/symbols.*must be an array/);
  });

  it("rejects an array containing a non-string element", () => {
    const error = validateArgs(SYMBOLS_ARRAY_SCHEMA, { symbols: ["TCS", 42] });
    expect(error).toMatch(/symbols.*must be an array of strings/);
  });

  it("rejects an array shorter than minItems", () => {
    const error = validateArgs(SYMBOLS_ARRAY_SCHEMA, { symbols: [] });
    expect(error).toMatch(/symbols.*at least 1 item/);
  });
});
