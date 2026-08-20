// fetch-historical-prices writes to historical_prices via the service-role
// key, which bypasses RLS — see docs/security-review.md finding #1's
// follow-up. See fetch-prices/auth-gate.test.ts for why no further mocking
// is needed for the "no Authorization header" case.
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

describe("fetch-historical-prices auth gate", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await handler(
      new Request("https://example.com/fetch-historical-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("lets an OPTIONS preflight through without an auth check", async () => {
    const res = await handler(new Request("https://example.com/fetch-historical-prices", { method: "OPTIONS" }));
    expect(res.status).not.toBe(401);
  });
});
