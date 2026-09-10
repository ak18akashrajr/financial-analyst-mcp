// Confirms a failed current_prices upsert is neither swallowed nor reported
// as a success. Before this, `await supabase.from("current_prices").upsert(...)`
// never checked its returned `error` at all — a real DB write failure (e.g. a
// constraint violation, RLS misconfiguration, connection drop) left the
// caller's response indistinguishable from every price having been persisted
// successfully, and nothing anywhere recorded that the write didn't happen.
// See fetch-benchmark-prices/index.ts for the same error-checked-upsert
// pattern this now matches.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: "user-1" }, reason: null }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

/** A minimal fake Supabase client: current_prices' select resolves with no
 * existing rows (so the fetched price always looks "changed" and reaches the
 * upsert call), and its upsert always reports a DB error. Every other table
 * (just app_logs, via db-log-sink) is a permissive no-op so the logger's
 * best-effort sink attach never itself throws. */
function fakeSupabaseClient(upsertError: { message: string } | null) {
  return {
    from: (table: string) => {
      if (table === "current_prices") {
        const builder = {
          select: () => builder,
          in: () => builder,
          upsert: () => Promise.resolve({ data: null, error: upsertError }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
        return builder;
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
      json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 123.45 } }] } }),
    }),
  );
  await import("./index.ts");
});

function priceRequest(symbols: string[]): Request {
  return new Request("https://example.com/fetch-prices", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ symbols }),
  });
}

describe("fetch-prices upsert error handling", () => {
  it("surfaces writeError in the response and does not silently claim success", async () => {
    upsertErrorForNextClient = { message: "duplicate key value violates unique constraint" };
    const res = await handler(priceRequest(["AAPL"]));
    const body = await res.json();

    expect(res.status).toBe(200); // the price lookup itself still succeeded — only the persist step failed
    expect(body.writeError).toBe("duplicate key value violates unique constraint");
  });

  it("reports writeError: null when the upsert succeeds", async () => {
    upsertErrorForNextClient = null;
    const res = await handler(priceRequest(["AAPL"]));
    const body = await res.json();

    expect(body.writeError).toBeNull();
  });
});
