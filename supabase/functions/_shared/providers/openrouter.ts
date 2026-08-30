// OpenRouter provider — OpenAI-compatible chat-completions API, backing the
// opt-in Nemotron 3 Ultra / MiniMax M2.7 escalation path (see
// docs/openrouter-nemotron-plan.md). Same message/tool-call shape as
// groq.ts; unlike groq.ts/anthropic.ts this one serves more than one model
// id through the same endpoint — the model id is chosen per-request by the
// caller (portfolio-ai/index.ts) and passed into runTurn, same as it already
// does for Groq's two-tier gpt-oss-20b/120b models.
import type { McpToolDef } from "../mcp-client.ts";
import { HttpCallError } from "../http-call-error.ts";
import { withRetry } from "../retry.ts";
import type { LlmProvider, ToolCallRequest, ToolResultForProvider, TurnResult } from "./types.ts";

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterProvider implements LlmProvider {
  readonly name = "openrouter";
  private apiKey: string;
  private messages: OpenRouterMessage[] = [];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  loadHistory(history: { role: "user" | "assistant"; content: string }[]): void {
    for (const h of history) this.messages.push({ role: h.role, content: h.content });
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  private toOpenRouterTools(tools: McpToolDef[]) {
    return tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  async runTurn(model: string, systemPrompt: string, tools: McpToolDef[]): Promise<TurnResult> {
    const data = await withRetry(async () => {
      const res = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter's recommended attribution headers, used for its own
          // dashboard/rankings — not used for auth, and harmless to omit if
          // OpenRouter ever drops the recommendation.
          "HTTP-Referer": "https://github.com/ak18akashrajr/financial-analyst-mcp",
          "X-Title": "Portfolio Intelligence AI",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...this.messages],
          tools: this.toOpenRouterTools(tools),
          stream: false,
        }),
      });
      if (!res.ok) throw new HttpCallError("OpenRouter", res.status, await res.text());
      const json = await res.json();
      // OpenRouter can return an HTTP 200 with an error body (or an empty
      // `choices`) instead of a non-2xx status when the selected free
      // model has no available upstream backend right now — a real
      // production case hit against nvidia/nemotron-3-ultra-550b-a55b:free.
      // Without this check that surfaces downstream as an opaque "Cannot
      // read properties of undefined (reading '0')" crash instead of a
      // classified, retryable failure that can fall back to Groq (see
      // portfolio-ai/index.ts's OpenRouter fallback).
      if (json.error || !json.choices?.length) {
        const status = typeof json.error?.code === "number" ? json.error.code : 502;
        throw new HttpCallError("OpenRouter", status, JSON.stringify(json.error ?? json));
      }
      return json;
    }, { label: "OpenRouter" });
    const message = data.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      this.messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
      const calls: ToolCallRequest[] = message.tool_calls.map((tc: OpenRouterToolCall) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      }));
      return { done: false, calls };
    }

    this.messages.push({ role: "assistant", content: message.content ?? "" });
    return { done: true, text: message.content ?? "" };
  }

  appendToolResults(results: ToolResultForProvider[]): void {
    for (const r of results) {
      this.messages.push({ role: "tool", tool_call_id: r.id, name: r.name, content: JSON.stringify(r.result) });
    }
  }
}
