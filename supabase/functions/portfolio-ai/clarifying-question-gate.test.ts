// Confirms ASK_CLARIFYING_QUESTION_TOOL's short-circuit in index.ts: a call
// to it is trusted as the final answer immediately — no forced-grounding
// retry (it IS a real tool call, so the anti-hallucination guard covered by
// tool-grounding-gate.test.ts never engages), no mcpClient.callTool round
// trip (it's synthetic, not SQL-backed), and no `tool_call` SSE event (the
// client's "Used N MCP tools" trace would be misleading for a call that
// touched no portfolio data). See system-prompt.test.ts for the prompt half
// (the "Ambiguous requests" section) and clarifying-question-tool.ts for why
// this has to be a tool call rather than a plain-text answer at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("../_shared/rate-limit.ts", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  RATE_LIMIT_MAX_REQUESTS: 10,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.100.1", () => ({
  createClient: () => ({}),
}));

const callToolMock = vi.fn().mockResolvedValue({ holdings: [] });
vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: callToolMock,
  })),
}));

const runTurnMock = vi.fn();
const addUserMessageMock = vi.fn();
vi.mock("../_shared/providers/groq.ts", () => ({
  GroqProvider: vi.fn().mockImplementation(() => ({
    name: "groq",
    loadHistory: vi.fn(),
    addUserMessage: addUserMessageMock,
    appendToolResults: vi.fn(),
    runTurn: runTurnMock,
  })),
}));

let handler: (req: Request) => Promise<Response> | Response;

beforeEach(async () => {
  vi.resetModules();
  runTurnMock.mockReset();
  addUserMessageMock.mockClear();
  callToolMock.mockClear();
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => (key === "GROQ_API_KEY" ? "test-key" : undefined) },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  await import("./index.ts");
});

function chatRequest(content: string): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
}

async function readAllEvents(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("portfolio-ai ask_clarifying_question short-circuit", () => {
  it("streams the question directly, with a single runTurn call and no forced-grounding retry", async () => {
    runTurnMock.mockResolvedValueOnce({
      done: false,
      calls: [{ id: "call-1", name: "ask_clarifying_question", arguments: { question: "Do you mean the calendar quarter or the FY quarter?" } }],
    });

    const res = await handler(chatRequest("how did I do last quarter?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    // Only the one turn — no forced-grounding retry, since this IS a real tool call.
    expect(runTurnMock).toHaveBeenCalledTimes(1);
    expect(addUserMessageMock).not.toHaveBeenCalledWith(expect.stringMatching(/without calling any tool/i));
    // Synthetic call never reaches the real MCP server.
    expect(callToolMock).not.toHaveBeenCalled();
    // No tool_call SSE event for the synthetic call.
    expect(text).not.toContain("event: tool_call");
    // chunkText splits the answer across multiple `delta` events (see
    // sse.ts), so check substrings that don't straddle a chunk boundary,
    // not the whole sentence — same convention as tool-grounding-gate.test.ts.
    expect(text).toContain("Do you mean the");
    expect(text).toContain("FY quarter?");
  });

  it("falls back to a generic question if the model's arguments are malformed", async () => {
    runTurnMock.mockResolvedValueOnce({
      done: false,
      calls: [{ id: "call-1", name: "ask_clarifying_question", arguments: {} }],
    });

    const res = await handler(chatRequest("how has my allocation changed?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(text).toContain("Could you clarify what");
    expect(text).toContain("you'd like to know?");
  });

  it("ignores any other calls bundled into the same turn as the clarifying question", async () => {
    runTurnMock.mockResolvedValueOnce({
      done: false,
      calls: [
        { id: "call-1", name: "list_holdings", arguments: {} },
        { id: "call-2", name: "ask_clarifying_question", arguments: { question: "Which symbol did you mean?" } },
      ],
    });

    const res = await handler(chatRequest("what if it drops 20%?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(callToolMock).not.toHaveBeenCalled();
    expect(text).toContain("Which symbol did you");
    expect(text).toContain("mean?");
  });
});
