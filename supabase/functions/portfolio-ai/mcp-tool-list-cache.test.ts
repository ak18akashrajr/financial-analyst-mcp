// portfolio-mcp-server's "initialize" and "tools/list" responses are both static (TOOL_REGISTRY
// never changes within a deployment — see mcp-tools.ts / portfolio-mcp-server/index.ts), so
// index.ts caches the resolved tool list at module scope instead of re-fetching it over the
// network on every chat request. This confirms the cache actually skips the redundant round trips
// on a second request within the same warm isolate, while still handing the model the full tool
// list (real MCP tools + the synthetic ASK_CLARIFYING_QUESTION_TOOL) every time — perf-only change,
// no behavior difference from the caller's point of view.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: "user-1" }, reason: null }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("../_shared/rate-limit.ts", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  RATE_LIMIT_MAX_REQUESTS: 10,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.100.1", () => ({
  createClient: () => ({}),
}));

const initializeMock = vi.fn().mockResolvedValue(undefined);
const listToolsMock = vi.fn().mockResolvedValue([
  { name: "get_portfolio_summary", description: "d", inputSchema: {} },
]);
vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: initializeMock,
    listTools: listToolsMock,
    callTool: vi.fn(),
  })),
}));

const runTurnMock = vi.fn().mockResolvedValue({ done: true, text: "ok" });
vi.mock("../_shared/providers/groq.ts", () => ({
  GroqProvider: vi.fn().mockImplementation(() => ({
    name: "groq",
    loadHistory: vi.fn(),
    addUserMessage: vi.fn(),
    appendToolResults: vi.fn(),
    runTurn: runTurnMock,
  })),
}));

let handler: (req: Request) => Promise<Response> | Response;

beforeEach(async () => {
  vi.resetModules();
  initializeMock.mockClear();
  listToolsMock.mockClear();
  runTurnMock.mockClear();
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

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("portfolio-ai MCP tool-list cache", () => {
  it("only initializes and lists tools once across two requests in the same warm isolate", async () => {
    const res1 = await handler(chatRequest("what's my portfolio worth?"));
    await drain(res1.body as ReadableStream<Uint8Array>);
    const res2 = await handler(chatRequest("what do I hold?"));
    await drain(res2.body as ReadableStream<Uint8Array>);

    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(listToolsMock).toHaveBeenCalledTimes(1);

    // Both requests still hand the model the full tool list (real MCP tools +
    // the synthetic clarifying-question tool) — the cache must not silently
    // drop tools from the second request onward.
    const toolsPassedFirst = runTurnMock.mock.calls[0][2] as { name: string }[];
    const toolsPassedSecond = runTurnMock.mock.calls[1][2] as { name: string }[];
    expect(toolsPassedFirst.map((t) => t.name)).toEqual(["get_portfolio_summary", "ask_clarifying_question"]);
    expect(toolsPassedSecond.map((t) => t.name)).toEqual(["get_portfolio_summary", "ask_clarifying_question"]);
  });

  it("re-initializes on a fresh (cold-start) module instance", async () => {
    const res = await handler(chatRequest("what's my portfolio worth?"));
    await drain(res.body as ReadableStream<Uint8Array>);
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(listToolsMock).toHaveBeenCalledTimes(1);
  });
});
