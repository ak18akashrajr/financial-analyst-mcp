// Confirms portfolio-ai's top-level catch (pre-stream failures, e.g. our own
// portfolio-mcp-server being unreachable) returns a classified status/message
// via chat-error-classifier.ts instead of one flat 500 "Something went
// wrong" for every possible cause — the same fix applied mid-stream in
// _shared/sse.ts (see sse.test.ts). The classifier's own mapping is
// unit-tested in chat-error-classifier.test.ts; this only checks index.ts
// wires it into the top-level catch correctly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpCallError as HttpCallErrorType } from "../_shared/http-call-error.ts";

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

const initializeMock = vi.fn();
vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: initializeMock,
    listTools: vi.fn().mockResolvedValue([]),
  })),
}));

let handler: (req: Request) => Promise<Response> | Response;
// Bound fresh below, after vi.resetModules() — importing HttpCallError once
// at module scope (before the reset) would give a different class object
// than the one chat-error-classifier.ts sees after index.ts is re-imported,
// which would break `instanceof HttpCallError` inside the classifier even
// though both are "the same" file.
let HttpCallError: typeof HttpCallErrorType;

beforeEach(async () => {
  vi.resetModules();
  initializeMock.mockReset();
  vi.stubGlobal("Deno", {
    env: { get: (_key: string) => undefined },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
  await import("./index.ts");
});

function chatRequest(): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("portfolio-ai top-level catch, classified errors", () => {
  it("returns 429 with a rate-limited message when the MCP server call fails with a 429", async () => {
    initializeMock.mockRejectedValue(new HttpCallError("MCP server initialize", 429, "rate limited"));
    const res = await handler(chatRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/high volume of requests/i);
    expect(body.error).not.toContain("429");
  });

  it("returns 503 with an unavailable message when the MCP server call fails with a 503", async () => {
    initializeMock.mockRejectedValue(new HttpCallError("MCP server initialize", 503, "down for maintenance"));
    const res = await handler(chatRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/temporarily unavailable/i);
  });

  it("falls back to a generic 500 for an unclassified error, without leaking its message", async () => {
    initializeMock.mockRejectedValue(new Error("No LLM API keys configured (set GROQ_API_KEY or ANTHROPIC_API_KEY)"));
    const res = await handler(chatRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("API_KEY");
    expect(body.error).toMatch(/something went wrong/i);
  });
});
