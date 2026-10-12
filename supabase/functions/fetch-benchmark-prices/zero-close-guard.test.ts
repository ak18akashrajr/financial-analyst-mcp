// Same guard as fetch-historical-prices: a 0 close is a bad bar, not an index level. A 0 in benchmark_history gives
// a -100% day and an infinite rebound in beta, alpha and the benchmark XIRR replay (audit, Low).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: "user-1" }, reason: null }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

/** Every row handed to `.upsert(...)` on the table under test, across all calls. */
const upserted: Record<string, unknown>[] = [];

function fakeSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "benchmark_history") {
        const builder = {
          select: () => builder,
          in: () => builder,
          upsert: (rows: Record<string, unknown>[]) => {
            upserted.push(...rows);
            return Promise.resolve({ data: null, error: null });
          },
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
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeSupabaseClient() }));

let handler: (req: Request) => Promise<Response> | Response;

async function load(yahooBody: (url: string) => unknown) {
  vi.resetModules();
  upserted.length = 0;
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => (key === "SUPABASE_URL" ? "https://example.supabase.co" : key === "SUPABASE_SERVICE_ROLE_KEY" ? "k" : undefined) },
    serve: (h: (req: Request) => Promise<Response> | Response) => { handler = h; },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => yahooBody(String(url)) })));
  await import("./index.ts");
}

const post = (path: string, body: unknown) =>
  new Request(`https://example.com/${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("fetch-benchmark-prices skips non-positive closes", () => {
  beforeEach(async () => {
    await load(() => ({
      chart: {
        result: [{
          timestamp: [1700000000, 1700086400, 1700172800, 1700259200],
          indicators: { quote: [{ close: [21000, 0, null, -5] }] },
        }],
      },
    }));
  });

  it("returns and stores only the valid close", async () => {
    const res = await handler(post("fetch-benchmark-prices", { symbols: ["NIFTY50"] }));
    const body = await res.json();

    expect(body.benchmarks.NIFTY50).toHaveLength(1);
    expect(body.benchmarks.NIFTY50[0].close).toBe(21000);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ symbol: "NIFTY50", close: 21000 });
  });
});
