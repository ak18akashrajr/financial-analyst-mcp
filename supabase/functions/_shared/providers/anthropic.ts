// Anthropic provider — Claude Messages API. Becomes the active provider
// (instead of Groq) whenever ANTHROPIC_API_KEY is set; see portfolio-ai/index.ts.
import type { McpToolDef } from "../mcp-client.ts";
import { HttpCallError } from "../http-call-error.ts";
import { withRetry } from "../retry.ts";
import type { LlmProvider, ToolCallRequest, ToolResultForProvider, TurnResult } from "./types.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private messages: AnthropicMessage[] = [];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  loadHistory(history: { role: "user" | "assistant"; content: string }[]): void {
    for (const h of history) this.messages.push({ role: h.role, content: h.content });
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  private toAnthropicTools(tools: McpToolDef[]) {
    return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }

  private headers() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    };
  }

  async runTurn(model: string, systemPrompt: string, tools: McpToolDef[]): Promise<TurnResult> {
    const data = await withRetry(async () => {
      const res = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: this.messages,
          tools: this.toAnthropicTools(tools),
        }),
      });
      if (!res.ok) throw new HttpCallError("Anthropic", res.status, await res.text());
      return res.json();
    }, { label: "Anthropic" });
    const blocks: ContentBlock[] = data.content;

    const toolUseBlocks = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    this.messages.push({ role: "assistant", content: blocks });

    if (toolUseBlocks.length > 0) {
      const calls: ToolCallRequest[] = toolUseBlocks.map((b) => ({ id: b.id, name: b.name, arguments: b.input }));
      return { done: false, calls };
    }

    const text = blocks
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { done: true, text };
  }

  appendToolResults(results: ToolResultForProvider[]): void {
    const content: ContentBlock[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: JSON.stringify(r.result),
    }));
    this.messages.push({ role: "user", content });
  }
}
