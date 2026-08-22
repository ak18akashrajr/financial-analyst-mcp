// fetch-pe-ratio proxies to Yahoo Finance under the project's own
// crumb/cookie session with no per-caller cost — see docs findings on
// fetch-prices for why the platform's verify_jwt alone isn't enough (it
// accepts the public anon key). This confirms the requireUser gate rejects
// a request with no session before any Yahoo Finance call happens.
// requireUser itself is unit-tested in _shared/auth.test.ts; the "no
// Authorization header" case exercised here short-circuits before any
// network call, so no further mocking is needed.
import { beforeAll, describe, expect, it, vi } from "vitest";

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

describe("fetch-pe-ratio auth gate", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await handler(
      new Request("https://example.com/fetch-pe-ratio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "AAPL" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("lets an OPTIONS preflight through without an auth check", async () => {
    const res = await handler(new Request("https://example.com/fetch-pe-ratio", { method: "OPTIONS" }));
    expect(res.status).not.toBe(401);
  });
});
