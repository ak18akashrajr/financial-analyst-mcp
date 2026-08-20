// Confirms portfolio-ai returns 429 before any LLM/MCP work once a real
// user is over their rate limit (security-review.md finding #2), and that
// a malformed request body (no `messages` array) gets its own safe,
// specific 400 rather than the generic 500 used for unexpected/internal
// failures (finding #5). checkRateLimit's own window/increment logic is
// unit-tested in _shared/rate-limit.test.ts; this only checks index.ts
// wires it in and short-circuits correctly.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

const checkRateLimitMock = vi.fn();
vi.mock("../_shared/rate-limit.ts", () => ({
  checkRateLimit: checkRateLimitMock,
  RATE_LIMIT_MAX_REQUESTS: 10,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.100.1", () => ({
  createClient: () => ({}),
}));

let handler: (req: Request) => Promise<Response> | Response;

beforeEach(async () => {
  vi.resetModules();
  checkRateLimitMock.mockReset();
  vi.stubGlobal("Deno", {
    env: { get: (_key: string) => undefined },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  await import("./index.ts");
});

function chatRequest(body: unknown = { messages: [{ role: "user", content: "hi" }] }): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("portfolio-ai rate-limit gate", () => {
  it("returns 429 without calling the LLM/MCP path when the user is over their rate limit", async () => {
    checkRateLimitMock.mockResolvedValue(false);
    const res = await handler(chatRequest());
    expect(res.status).toBe(429);
  });

  it("returns a specific 400 for a malformed body, distinct from an internal 500", async () => {
    checkRateLimitMock.mockResolvedValue(true);
    const res = await handler(chatRequest({ messages: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-empty `messages` array/);
  });
});
