import type { McpToolDef } from "../mcp-client.ts";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type TurnResult = { done: true; text: string } | { done: false; calls: ToolCallRequest[] };

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
  runTurn(model: string, systemPrompt: string, tools: McpToolDef[]): Promise<TurnResult>;
  appendToolResults(results: ToolResultForProvider[]): void;
}
