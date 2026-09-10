// Confirms a failed historical_prices upsert is neither swallowed nor
// reported as a success. Before this, `await supabase.from("historical_prices")
// .upsert(...)` never checked its returned `error` at all (and Supabase's
// client doesn't throw on a DB error — it resolves with one), so the
// surrounding try/catch never saw it either: a real write failure looked
// identical to success both in the response and in the logs.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: "user-1" }, reason: null }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

function fakeSupabaseClient(upsertError: { message: string } | null) {
  return {
    from: (table: string) => {
      if (table === "historical_prices") {
        return { upsert: () => Promise.resolve({ data: null, error: upsertError }) };
      }
      const noop = {
        insert: () => Promise.resolve({ error: null }),
        select: () => noop,
        eq: () => noop,
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return noop;
    },
  };
}

let upsertErrorForNextClient: { message: string } | null = null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeSupabaseClient(upsertErrorForNextClient),
}));

let handler: (req: Request) => Promise<Response> | Response;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) => {
        if (key === "SUPABASE_URL") return "https://example.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "test-service-role-key";
        return undefined;
      },
    },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ close: [123.45] }] } }] },
      }),
    }),
  );
  await import("./index.ts");
});

function historyRequest(symbols: string[]): Request {
  return new Request("https://example.com/fetch-historical-prices", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ symbols }),
  });
}

describe("fetch-historical-prices upsert error handling", () => {
  it("surfaces a per-symbol writeError and still returns the fetched points", async () => {
    upsertErrorForNextClient = { message: "duplicate key value violates unique constraint" };
    const res = await handler(historyRequest(["AAPL"]));
    const body = await res.json();

    expect(res.status).toBe(200); // the fetch itself still succeeded — only the persist step failed
    expect(body.writeErrors).toEqual({ AAPL: "duplicate key value violates unique constraint" });
    expect(body.prices.AAPL).toHaveLength(1); // fetched points are still returned even though the write failed
  });

  it("reports an empty writeErrors object when every upsert succeeds", async () => {
    upsertErrorForNextClient = null;
    const res = await handler(historyRequest(["AAPL"]));
    const body = await res.json();

    expect(body.writeErrors).toEqual({});
  });
});
