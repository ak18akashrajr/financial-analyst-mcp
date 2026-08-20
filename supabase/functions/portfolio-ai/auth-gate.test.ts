// Confirms portfolio-ai rejects a request before doing any real work (no LLM
// call, no MCP call) when the caller isn't a real logged-in user — the fix
// for the bug where the frontend sent the public anon key instead of the
// user's session token, letting anyone read the whole portfolio without
// logging in. _shared/auth.ts's own logic is unit-tested separately in
// _shared/auth.test.ts; this file only checks index.ts wires it in and
// short-circuits correctly.
import { beforeAll, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();

vi.mock("../_shared/auth.ts", () => ({
  requireUser: requireUserMock,
  unauthorizedResponse: (corsHeaders: Record<string, string>) =>
    new Response(JSON.stringify({ error: "Unauthorized — please sign in again." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
}));

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (_key: string) => undefined },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  await import("./index.ts");
});

function chatRequest(): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("portfolio-ai auth gate", () => {
  it("returns 401 without calling the LLM/MCP path when requireUser finds no real session", async () => {
    requireUserMock.mockResolvedValueOnce(null);
    const res = await handler(chatRequest());
    expect(res.status).toBe(401);
    expect(requireUserMock).toHaveBeenCalledOnce();
  });

  it("lets an OPTIONS preflight through without an auth check", async () => {
    requireUserMock.mockClear();
    const res = await handler(new Request("https://example.com/portfolio-ai", { method: "OPTIONS" }));
    expect(res.status).not.toBe(401);
    expect(requireUserMock).not.toHaveBeenCalled();
  });
});
