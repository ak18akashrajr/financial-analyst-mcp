// Confirms the request-size guards added alongside the existing
// `messages` non-empty / `modelPreference` ValidationError checks
// (see docs/security-review.md's Fourth pass, item on portfolio-ai request
// size). The per-minute rate limiter (rate-limit-gate.test.ts) bounds
// request *count*; these bound payload *size* per request — an oversized
// conversation history or a single very long message, sent by a single
// authenticated user still within their own per-minute quota, should be
// rejected before any (billed) provider call is made.
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

vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
  })),
}));

const groqRunTurnMock = vi.fn();
vi.mock("../_shared/providers/groq.ts", () => ({
  GroqProvider: vi.fn().mockImplementation(() => ({
    name: "groq",
    loadHistory: vi.fn(),
    addUserMessage: vi.fn(),
    appendToolResults: vi.fn(),
    runTurn: groqRunTurnMock,
  })),
}));

let handler: (req: Request) => Promise<Response> | Response;
let MAX_MESSAGES: number;
let MAX_MESSAGE_CONTENT_LENGTH: number;

function stubEnv(vars: Record<string, string>) {
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => vars[key] },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
}

beforeEach(async () => {
  vi.resetModules();
  groqRunTurnMock.mockReset();
});

function chatRequest(messages: unknown[]): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
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

const groundedFirstTurn = { done: false, calls: [{ id: "call-1", name: "get_portfolio_summary", arguments: {} }] };

describe("portfolio-ai request-size validation", () => {
  it("rejects a `messages` array over the max length with a 400, before any provider is built", async () => {
    stubEnv({ GROQ_API_KEY: "test-key" });
    ({ MAX_MESSAGES } = await import("./index.ts"));

    const oversized = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "hi",
    }));
    const res = await handler(chatRequest(oversized));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Conversation is too long/);
    expect(groqRunTurnMock).not.toHaveBeenCalled();
  });

  it("rejects a message whose content exceeds the max length with a 400, before any provider is built", async () => {
    stubEnv({ GROQ_API_KEY: "test-key" });
    ({ MAX_MESSAGE_CONTENT_LENGTH } = await import("./index.ts"));

    const res = await handler(chatRequest([{ role: "user", content: "x".repeat(MAX_MESSAGE_CONTENT_LENGTH + 1) }]));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/characters or fewer/);
    expect(groqRunTurnMock).not.toHaveBeenCalled();
  });

  it("accepts a request exactly at both limits (boundary is inclusive, not exclusionary)", async () => {
    stubEnv({ GROQ_API_KEY: "test-key" });
    ({ MAX_MESSAGES, MAX_MESSAGE_CONTENT_LENGTH } = await import("./index.ts"));

    groqRunTurnMock.mockResolvedValueOnce(groundedFirstTurn).mockResolvedValueOnce({ done: true, text: "answer" });

    const history = Array.from({ length: MAX_MESSAGES - 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "hi",
    }));
    const atLimit = [...history, { role: "user", content: "x".repeat(MAX_MESSAGE_CONTENT_LENGTH) }];
    const res = await handler(chatRequest(atLimit));

    expect(res.status).toBe(200);
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);
    expect(text).toContain("event: done");
    expect(groqRunTurnMock).toHaveBeenCalledTimes(2);
  });
});
