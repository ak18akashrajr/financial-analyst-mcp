// Groq provider — OpenAI-compatible chat-completions API, used as the
// default/primary provider (see router.ts for the gpt-oss-20b/120b tiering).
import type { McpToolDef } from "../mcp-client.ts";
import { HttpCallError } from "../http-call-error.ts";
import { withRetry } from "../retry.ts";
import type { LlmProvider, ToolCallRequest, ToolResultForProvider, TurnResult } from "./types.ts";

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
}

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export class GroqProvider implements LlmProvider {
  readonly name = "groq";
  private apiKey: string;
  private messages: GroqMessage[] = [];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  loadHistory(history: { role: "user" | "assistant"; content: string }[]): void {
    for (const h of history) this.messages.push({ role: h.role, content: h.content });
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  private toGroqTools(tools: McpToolDef[]) {
    return tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  async runTurn(model: string, systemPrompt: string, tools: McpToolDef[]): Promise<TurnResult> {
    const data = await withRetry(async () => {
      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...this.messages],
          tools: this.toGroqTools(tools),
          stream: false,
        }),
      });
      if (!res.ok) throw new HttpCallError("Groq", res.status, await res.text());
      return res.json();
    }, { label: "Groq" });
    const message = data.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      this.messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
      const calls: ToolCallRequest[] = message.tool_calls.map((tc: GroqToolCall) => ({
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
