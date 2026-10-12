// A quoted price of 0 (or negative) is not a quote — Yahoo returns it for halted or delisted tickers. fetch-prices only
// skipped null, so a 0 was stored in current_prices and the app valued the holding at ₹0 with a -100% loss
// (audit, Low). It is now treated as missing, like a failed lookup.
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
      if (table === "current_prices") {
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

describe("fetch-prices rejects non-positive prices", () => {
  beforeEach(async () => {
    await load((url) => {
      const price = url.includes("ZERO") ? 0 : url.includes("NEG") ? -4 : 50;
      return { chart: { result: [{ meta: { regularMarketPrice: price } }] } };
    });
  });

  it("reports a 0 or negative price as null and never writes it", async () => {
    const res = await handler(post("fetch-prices", { symbols: ["GOOD", "ZERO", "NEG"] }));
    const body = await res.json();

    expect(body.prices.GOOD).toBe(50);
    expect(body.prices.ZERO).toBeNull();
    expect(body.prices.NEG).toBeNull();
    expect(upserted.map((r) => r.symbol)).toEqual(["GOOD"]);
    expect(upserted.every((r) => Number(r.price) > 0)).toBe(true);
  });
});
