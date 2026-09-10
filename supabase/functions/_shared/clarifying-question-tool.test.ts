import { describe, expect, it } from "vitest";
import { ASK_CLARIFYING_QUESTION_TOOL } from "./clarifying-question-tool.ts";

describe("ASK_CLARIFYING_QUESTION_TOOL", () => {
  it("is named ask_clarifying_question and requires a non-empty question string", () => {
    expect(ASK_CLARIFYING_QUESTION_TOOL.name).toBe("ask_clarifying_question");
    const schema = ASK_CLARIFYING_QUESTION_TOOL.inputSchema as {
      required: string[];
      properties: { question: { type: string; minLength: number } };
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["question"]);
    expect(schema.properties.question.type).toBe("string");
    expect(schema.properties.question.minLength).toBeGreaterThan(0);
    // No room for the model to smuggle other args through this tool.
    expect(schema.additionalProperties).toBe(false);
  });
});
