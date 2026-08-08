// Portfolio AI agent backend.
//
// Provider selection: Claude Sonnet 5 (Anthropic) if ANTHROPIC_API_KEY is
// set, otherwise Groq with a two-tier gpt-oss-20b/120b heuristic router for
// token optimization (see _shared/router.ts). Switching providers later is
// an env-var change only — no code changes needed.
//
// Tools: no more prose-pretend tools or single mega context-dump. Every
// portfolio fact is fetched on demand through a real MCP tools/call request
// to portfolio-mcp-server (see docs/llm-mcp-agent-plan.md).
import { McpClient } from "../_shared/mcp-client.ts";
import { GROQ_COMPLEX_MODEL, GROQ_SIMPLE_MODEL, isComplexQuery, shouldEscalate } from "../_shared/router.ts";
import { findTool } from "../_shared/mcp-tools.ts";
import { GroqProvider } from "../_shared/providers/groq.ts";
import { AnthropicProvider } from "../_shared/providers/anthropic.ts";
import type { LlmProvider, ToolResultForProvider } from "../_shared/providers/types.ts";
import { chunkText, createSseStream } from "../_shared/sse.ts";
import { createLogger } from "../_shared/logger.ts";

const logger = createLogger("portfolio-ai");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_TOOL_TURNS = 5;

const SYSTEM_PROMPT = `You are Portfolio Intelligence AI, an expert portfolio analyst with real tool access to the user's live portfolio data via the Model Context Protocol (MCP).

You do not have any portfolio data memorized — call the provided tools to get real, current numbers before answering. Never guess or fabricate financial figures.

Guidelines:
- Only call the tool(s) needed to answer the specific question asked. Do not proactively run
  extra analyses (concentration risk, limit breaches, rebalancing suggestions, exposure drift,
  etc.) unless the user's question calls for them or they explicitly ask for a fuller review.
  "Show me my holdings" means call list_holdings and answer with that — nothing more.
- Keep answers concise and scannable. Default to a short table or a few bullet points; only
  write a longer narrative report if the user asks for a summary, review, or analysis.
- Format currency in Indian style (₹, Lakhs, Crores) where the data is in INR.
- Be specific: name actual holdings and percentages from tool results, never generic advice.
- When presenting tabular data, use proper GitHub-flavored Markdown tables — a header row, a
  separator row, then one data row per line (never collapse rows into a single line).
- Be conversational but data-driven. Only end with a recommendation if the question invited one.
- The user's message may contain typos or informal phrasing — interpret their intent rather than
  asking for clarification on minor spelling issues.`;

interface ChatRequestMessage {
  role: "user" | "assistant";
  content: string;
}

function buildProvider(): { provider: LlmProvider; model: string; attribution: string } {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    return { provider: new AnthropicProvider(anthropicKey), model: CLAUDE_MODEL, attribution: "Claude Sonnet 5" };
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) throw new Error("No LLM API keys configured (set GROQ_API_KEY or ANTHROPIC_API_KEY)");
  return { provider: new GroqProvider(groqKey), model: "", attribution: "" }; // model/attribution set per-request by the router
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = (await req.json()) as { messages: ChatRequestMessage[] };
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Request must include a non-empty `messages` array");
    }

    const history = messages.slice(0, -1);
    const latest = messages[messages.length - 1];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mcpClient = new McpClient(`${supabaseUrl}/functions/v1/portfolio-mcp-server`, `Bearer ${serviceRoleKey}`);
    await mcpClient.initialize();
    const tools = await mcpClient.listTools();

    const { provider, model: fixedModel, attribution: fixedAttribution } = buildProvider();
    const usingAnthropic = fixedModel === CLAUDE_MODEL;

    // Groq two-tier routing: pick the model up front from the heuristic, escalate mid-loop if needed.
    let model = fixedModel;
    let attribution = fixedAttribution;
    let escalated = false;
    if (!usingAnthropic) {
      model = isComplexQuery(latest.content) ? GROQ_COMPLEX_MODEL : GROQ_SIMPLE_MODEL;
      attribution = model === GROQ_COMPLEX_MODEL ? "GPT-OSS 120B via Groq" : "GPT-OSS 20B via Groq";
    }

    provider.loadHistory(history);
    provider.addUserMessage(latest.content);

    logger.info("Chat request started", { model, attribution, historyLength: history.length });
    const requestStartedAt = Date.now();

    const stream = createSseStream(async (send) => {
      let toolCallCount = 0;
      let invokedComplexTool = false;
      let finalText = "";

      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const result = await provider.runTurn(model, SYSTEM_PROMPT, tools);

          // Explicit `=== true` (not a bare truthy check) so TS reliably narrows
          // this boolean-discriminated union in the `else` path below.
          if (result.done === true) {
            finalText = result.text;
            break;
          }

          // Groq-only escalation safety net: if the cheap tier needs too many tool
          // calls or touches a "complex" tool, restart this turn on the bigger model.
          if (!usingAnthropic && model === GROQ_SIMPLE_MODEL) {
            toolCallCount += result.calls.length;
            invokedComplexTool ||= result.calls.some((c) => findTool(c.name)?.complexity === "complex");
            if (shouldEscalate(toolCallCount, invokedComplexTool) && !escalated) {
              escalated = true;
              model = GROQ_COMPLEX_MODEL;
              attribution = "GPT-OSS 120B via Groq (escalated)";
            }
          }

          const toolResults: ToolResultForProvider[] = [];
          for (const call of result.calls) {
            send("tool_call", { name: call.name, args: call.arguments });
            try {
              const toolResult = await mcpClient.callTool(call.name, call.arguments);
              toolResults.push({ id: call.id, name: call.name, result: toolResult });
            } catch (err) {
              logger.error("Tool call failed", { tool: call.name, error: err });
              toolResults.push({
                id: call.id,
                name: call.name,
                result: { error: err instanceof Error ? err.message : "Tool call failed" },
              });
            }
          }
          provider.appendToolResults(toolResults);

          if (turn === MAX_TOOL_TURNS - 1) {
            throw new Error("Tool loop exceeded the maximum number of turns");
          }
        }

        for (const chunk of chunkText(finalText)) {
          send("delta", { text: chunk });
        }
        send("done", { attribution });
        logger.info("Chat request completed", {
          model,
          attribution,
          escalated,
          toolCallCount,
          duration_ms: Date.now() - requestStartedAt,
        });
      } catch (err) {
        logger.error("Chat stream failed", {
          model,
          duration_ms: Date.now() - requestStartedAt,
          error: err,
        });
        throw err;
      }
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    logger.error("portfolio-ai error", { error: e });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
