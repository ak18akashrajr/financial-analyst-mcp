// The unbounded reads in portfolio-data.ts / mcp-tools.ts must page past PostgREST's silent
// 1,000-row response cap (audit H6). The fake client below enforces that cap exactly like the real
// API: a response never has more than 1,000 rows, whether or not `.range()` asked for more.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTxns, getPortfolioValueAsOf } from "./portfolio-data.ts";

const RESPONSE_CAP = 1000;
type Rows = Record<string, unknown>[];

function cappedBuilder(all: Rows) {
  let rows = [...all];
  let from = 0;
  let to = Infinity;
  const keys: Array<{ col: string; asc: boolean }> = [];
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return builder; },
    in: (c: string, vs: unknown[]) => { const set = new Set(vs); rows = rows.filter((r) => set.has(r[c])); return builder; },
    lte: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] as string) <= (v as string)); return builder; },
    order: (col: string, o?: { ascending?: boolean }) => { keys.push({ col, asc: o?.ascending !== false }); return builder; },
    limit: (n: number) => { to = Math.min(to, n - 1); return builder; },
    range: (f: number, t: number) => { from = f; to = t; return builder; },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } }),
    then: (resolve: any) => {
      const sorted = [...rows].sort((a, b) => {
        for (const { col, asc } of keys) {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) continue;
          return (av > bv ? 1 : -1) * (asc ? 1 : -1);
        }
        return 0;
      });
      const page = sorted.slice(from, Math.min(to + 1, from + RESPONSE_CAP));
      return Promise.resolve({ data: page, error: null }).then(resolve);
    },
  };
  return builder;
}
const fakeSb = (tables: Record<string, Rows>) =>
  ({ from: (t: string) => cappedBuilder(tables[t] ?? []) }) as unknown as SupabaseClient;

const isoDay = (offset: number) => new Date(Date.UTC(2020, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);

describe("1,000-row response cap (audit H6)", () => {
  it("fetchTxns returns every transaction, including the newest beyond the first page", async () => {
    const rows: Rows = Array.from({ length: 1_500 }, (_, i) => ({
      id: `id-${String(i).padStart(5, "0")}`,
      symbol: "TCS",
      type: "BUY",
      quantity: 1,
      price: 100,
      date: isoDay(i),
    }));
    const txns = await fetchTxns(fakeSb({ transactions: rows }));
    expect(txns).toHaveLength(1_500);
    expect(txns[txns.length - 1].date).toBe(isoDay(1_499)); // unpaged, the cap kept only the oldest 1,000
  });

  it("does not skip or duplicate rows that tie on the sort key across a page boundary", async () => {
    // 1,200 rows sharing one timestamp: only the `id` tie-break makes the paging deterministic.
    const rows: Rows = Array.from({ length: 1_200 }, (_, i) => ({
      id: `id-${String(i).padStart(5, "0")}`,
      symbol: "TCS",
      type: "BUY",
      quantity: 1,
      price: 100,
      date: "2026-01-01T00:00:00+00:00",
    }));
    const txns = await fetchTxns(fakeSb({ transactions: rows }));
    expect(new Set(txns.map((t: any) => t.id)).size).toBe(1_200);
  });

  it("prices a symbol whose latest close sits past the first 1,000 newest-first rows", async () => {
    // AAA has 1,100 daily closes ending 2026-09-30; BBB has a single, older close. Newest-first, all of
    // BBB's rows fall after AAA's 1,100 — an unpaged read returned only AAA and dropped BBB as "unpriced".
    const lastDay = 2_100;
    const aaa: Rows = Array.from({ length: 1_100 }, (_, i) => ({
      id: `a-${i}`, symbol: "AAA", date: isoDay(lastDay - i), close: 10,
    }));
    const bbb: Rows = [{ id: "b-0", symbol: "BBB", date: isoDay(10), close: 50 }];
    const asOf = isoDay(lastDay);
    const sb = fakeSb({
      transactions: [
        { id: "t1", symbol: "AAA", type: "BUY", quantity: 1, price: 5, date: isoDay(5) },
        { id: "t2", symbol: "BBB", type: "BUY", quantity: 2, price: 40, date: isoDay(5) },
      ],
      historical_prices: [...aaa, ...bbb],
      symbol_metadata: [],
      net_worth_history: [],
    });
    const result: any = await getPortfolioValueAsOf(sb, asOf);
    expect(result.equityValue).toBe(110); // 1×10 + 2×50 — BBB included
    expect(result.holdingsCount).toBe(2);
    expect(result.note).not.toMatch(/BBB/); // no "excluded — no price" note
  });
});
