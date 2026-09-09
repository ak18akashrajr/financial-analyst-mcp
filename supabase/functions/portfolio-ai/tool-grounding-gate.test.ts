// Confirms the forced-grounding-retry guard in index.ts: a turn-0 answer
// that never called any tool is NOT trusted as final — it gets one
// corrective nudge plus a forced (tool_choice: "required") retry before any
// answer is streamed to the user. This is the code-level half of the fix for
// the 2026-09-08 bug where gpt-oss-20b answered "is there any tax for me?"
// with a fully invented transaction table instead of calling list_transactions
// or declining — see system-prompt.test.ts for the prompt-wording half.
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

const callToolMock = vi.fn().mockResolvedValue({ transactions: [], buyCount: 0, sellCount: 0 });
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

describe("portfolio-ai forced-grounding retry", () => {
  it("does not trust a turn-0 answer with zero tool calls — retries once with tool_choice forced, then streams the grounded answer", async () => {
    runTurnMock
      // Turn 0: the hallucination shape — a confident answer, no tool call.
      .mockResolvedValueOnce({ done: true, text: "Here are your recent trades: HDFC BANK, SBIN, TCS..." })
      // Forced retry (tool_choice: "required"): now it actually calls a tool.
      .mockResolvedValueOnce({ done: false, calls: [{ id: "call-1", name: "list_transactions", arguments: {} }] })
      // Final turn, grounded in the real (empty) tool result.
      .mockResolvedValueOnce({ done: true, text: "You have no transactions on record." });

    const res = await handler(chatRequest("can you list is there any tax for me?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(runTurnMock).toHaveBeenCalledTimes(3);
    // 1st call: default "auto". 2nd call (the forced retry): "required".
    expect(runTurnMock.mock.calls[0][3]).toBe("auto");
    expect(runTurnMock.mock.calls[1][3]).toBe("required");
    // 3rd call (after the forced tool call already grounded the turn): back to "auto".
    expect(runTurnMock.mock.calls[2][3]).toBe("auto");

    // The corrective nudge was actually sent to the model.
    expect(addUserMessageMock).toHaveBeenCalledWith(expect.stringMatching(/without calling any tool/i));
    // The real tool got called, forwarding the request's correlation id
    // (see mcp-client.ts's `requestId` param) as the 4th arg.
    expect(callToolMock).toHaveBeenCalledWith("list_transactions", {}, "user-1", expect.any(String));

    // The user only ever sees the grounded final answer — never the
    // fabricated turn-0 text. chunkText splits the answer across multiple
    // `delta` events (see sse.ts), so check substrings, not one sentence.
    expect(text).toContain("You have no transactions");
    expect(text).toContain("on record.");
    expect(text).not.toContain("HDFC BANK");
  });

  it("does not retry a turn-0 answer that already made a real tool call, even if a later turn has none", async () => {
    runTurnMock
      .mockResolvedValueOnce({ done: false, calls: [{ id: "call-1", name: "list_holdings", arguments: {} }] })
      .mockResolvedValueOnce({ done: true, text: "You hold 10 shares of TCS." });

    const res = await handler(chatRequest("what do I hold?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(runTurnMock).toHaveBeenCalledTimes(2);
    expect(addUserMessageMock).not.toHaveBeenCalledWith(expect.stringMatching(/without calling any tool/i));
    expect(text).toContain("You hold 10 shares");
    expect(text).toContain("of TCS.");
  });

  it("only ever retries once, even if the forced retry itself comes back with no tool call", async () => {
    runTurnMock
      .mockResolvedValueOnce({ done: true, text: "fabricated answer" })
      // Even under tool_choice: "required" a misbehaving/mocked provider
      // could still return done:true — the guard must not loop forever.
      .mockResolvedValueOnce({ done: true, text: "still no tool call" });

    const res = await handler(chatRequest("is there any tax for me?"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(runTurnMock).toHaveBeenCalledTimes(2);
    expect(text).toContain("still no tool call");
  });
});
