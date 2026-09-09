import type { McpToolDef } from "../mcp-client.ts";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Token counts a provider's own response reported for one runTurn() call —
 * see providers/groq.ts and providers/openrouter.ts. Undefined (not zeroed)
 * on TurnResult when the provider's response carried no usage field at all,
 * so callers can distinguish "really used 0 tokens" from "provider didn't
 * report usage" (observed on some OpenRouter free-tier responses). */
export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
}

export type TurnResult =
  | { done: true; text: string; usage?: TurnUsage }
  | { done: false; calls: ToolCallRequest[]; usage?: TurnUsage };

// "required" forces the model to invoke at least one tool this turn (it
// cannot return a plain-text final answer) — used exactly once, as a
// grounding retry, when a turn comes back with no tool calls at all (see
// portfolio-ai/index.ts's forced-grounding-retry loop). Every other call
// uses "auto" (the default), same as before this existed.
export type ToolChoice = "auto" | "required";

export interface ToolResultForProvider {
  id: string;
  name: string;
  result: unknown;
}

/**
 * Common shape every provider module implements. Each provider owns its
 * native message-array format internally; callers only interact through
 * these methods so portfolio-ai/index.ts stays provider-agnostic.
 */
export interface LlmProvider {
  readonly name: string;
  loadHistory(history: { role: "user" | "assistant"; content: string }[]): void;
  addUserMessage(text: string): void;
  /** One non-streamed turn with tools enabled — either a final text answer or a request to call tools. */
  runTurn(model: string, systemPrompt: string, tools: McpToolDef[], toolChoice?: ToolChoice): Promise<TurnResult>;
  appendToolResults(results: ToolResultForProvider[]): void;
}
