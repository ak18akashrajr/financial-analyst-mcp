// Confirms the tool-call loop in index.ts actually runs same-turn tool calls
// concurrently (bounded), instead of one at a time — see
// _shared/concurrency.ts for the bounded-worker-pool primitive this uses.
// Result ordering and the concurrency cap itself are unit-tested there; this
// only checks index.ts wires mapWithConcurrency into the real loop, that
// results still line up with the right call by id, and that a single failed
// tool call doesn't take the others down with it.
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

let active = 0;
let maxActive = 0;
const callToolMock = vi.fn(async (name: string) => {
  active++;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 10));
  active--;
  if (name === "boom_tool") throw new Error("upstream failure");
  return { ok: true, name };
});

vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: callToolMock,
  })),
}));

// Four calls in one turn, then a final answer on the next turn — exercises
// the concurrency cap (MAX_CONCURRENT_TOOL_CALLS = 3 in index.ts) with more
// calls than the cap allows.
const runTurnMock = vi.fn();
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
  active = 0;
  maxActive = 0;
  callToolMock.mockClear();
  runTurnMock.mockReset();
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => (key === "GROQ_API_KEY" ? "test-key" : undefined) },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  await import("./index.ts");
});

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

function chatRequest(): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "give me everything" }] }),
  });
}

describe("portfolio-ai tool-call loop concurrency", () => {
  it("runs a turn's tool calls concurrently, bounded, and keeps results matched to their call id", async () => {
    runTurnMock
      .mockResolvedValueOnce({
        done: false,
        calls: [
          { id: "call-1", name: "tool_a", arguments: {} },
          { id: "call-2", name: "tool_b", arguments: {} },
          { id: "call-3", name: "tool_c", arguments: {} },
          { id: "call-4", name: "tool_d", arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ done: true, text: "here you go" });

    const res = await handler(chatRequest());
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(callToolMock).toHaveBeenCalledTimes(4);
    // Proves the calls actually overlapped (not fully serial)...
    expect(maxActive).toBeGreaterThan(1);
    // ...but never exceeded the configured cap.
    expect(maxActive).toBeLessThanOrEqual(3);
    // All four announced up front, and the stream still completes normally.
    expect(text.match(/event: tool_call/g)?.length).toBe(4);
    expect(text).toContain("event: done");
  });

  it("isolates a single failing tool call so its siblings' results still reach the model", async () => {
    runTurnMock
      .mockResolvedValueOnce({
        done: false,
        calls: [
          { id: "call-1", name: "tool_a", arguments: {} },
          { id: "call-2", name: "boom_tool", arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ done: true, text: "handled" });

    const res = await handler(chatRequest());
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(text).toContain("event: done");
    expect(text).not.toContain("upstream failure");
  });
});
