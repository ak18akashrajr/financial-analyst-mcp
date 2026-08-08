import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBenchmarkCompareNote,
  checkLimitBreaches,
  compareToBenchmark,
  computeHoldingsFromTxns,
  concentrationRisk,
  exposureBy,
  getRiskMetrics,
  runStressTest,
  type Holding,
  type Txn,
} from "./portfolio-data.ts";

const META = {
  AAPL: { geography: "US", sector: "Tech" },
  TCS: { geography: "India", sector: "Tech" },
  HDFC: { geography: "India", sector: "Financials" },
};

describe("computeHoldingsFromTxns", () => {
  const txns: Txn[] = [
    { symbol: "AAPL", type: "BUY", quantity: 10, price: 100, date: "2026-01-01" },
    { symbol: "AAPL", type: "BUY", quantity: 10, price: 120, date: "2026-02-01" },
    { symbol: "TCS", type: "BUY", quantity: 5, price: 200, date: "2026-01-15" },
    { symbol: "TCS", type: "SELL", quantity: 5, price: 250, date: "2026-03-01" },
  ];
  const prices = { AAPL: 150, TCS: 300 };

  it("nets BUY/SELL into quantity and weighted average price", () => {
    const holdings = computeHoldingsFromTxns(txns, prices, META);
    const aapl = holdings.find((h) => h.symbol === "AAPL")!;
    expect(aapl.quantity).toBe(20);
    expect(aapl.avgPrice).toBeCloseTo(110); // (10*100 + 10*120) / 20
    expect(aapl.currentValue).toBeCloseTo(3000); // 20 * 150
    expect(aapl.pnl).toBeCloseTo(800); // 3000 - 2200
  });

  it("drops fully-closed positions", () => {
    const holdings = computeHoldingsFromTxns(txns, prices, META);
    expect(holdings.find((h) => h.symbol === "TCS")).toBeUndefined();
  });

  it("respects asOfDate for point-in-time reconstruction", () => {
    const asOf = computeHoldingsFromTxns(txns, { AAPL: 110, TCS: 200 }, META, "2026-01-20");
    const aapl = asOf.find((h) => h.symbol === "AAPL")!;
    const tcs = asOf.find((h) => h.symbol === "TCS")!;
    expect(aapl.quantity).toBe(10); // second BUY (2026-02-01) excluded
    expect(tcs.quantity).toBe(5); // SELL (2026-03-01) excluded, still open
  });
});

function makeHolding(overrides: Partial<Holding>): Holding {
  return {
    symbol: "X",
    quantity: 1,
    avgPrice: 100,
    currentPrice: 100,
    invested: 100,
    currentValue: 100,
    pnl: 0,
    pnlPercent: 0,
    geography: "India",
    category: "Tech",
    ...overrides,
  };
}

describe("exposureBy", () => {
  it("computes percent shares that sum to ~100", () => {
    const holdings = [
      makeHolding({ symbol: "A", currentValue: 600, geography: "India" }),
      makeHolding({ symbol: "B", currentValue: 400, geography: "US" }),
    ];
    const exposure = exposureBy(holdings, "geography");
    expect(exposure.find((e) => e.label === "India")?.percent).toBe(60);
    expect(exposure.find((e) => e.label === "US")?.percent).toBe(40);
  });
});

describe("concentrationRisk", () => {
  it("returns the top-N holdings and their combined weight", () => {
    const holdings = [
      makeHolding({ symbol: "A", currentValue: 500 }),
      makeHolding({ symbol: "B", currentValue: 300 }),
      makeHolding({ symbol: "C", currentValue: 200 }),
    ];
    const { rows, topNWeight } = concentrationRisk(holdings, 2);
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B"]);
    expect(topNWeight).toBeCloseTo(80); // (500+300)/1000 * 100
  });
});

describe("checkLimitBreaches", () => {
  it("flags a single holding over 15%", () => {
    const holdings = [
      makeHolding({ symbol: "A", currentValue: 2000, geography: "India", category: "Tech" }),
      makeHolding({ symbol: "B", currentValue: 8000, geography: "India", category: "Financials" }),
    ];
    const breaches = checkLimitBreaches(holdings);
    // B is 80% of the portfolio — breaches single_holding, top5, and category/geography limits.
    expect(breaches.some((b) => b.type === "single_holding" && b.label === "B")).toBe(true);
  });

  it("reports no breaches for a balanced portfolio", () => {
    // 10 equal-weight (10% each) holdings: geography split 4/3/3 (40%/30%/30%)
    // and category split 4/3/3 — every limit (15% single, 50% top-5, 40%
    // sector/geography) sits at or under threshold, so nothing should trip.
    const geographies = ["G1", "G1", "G1", "G1", "G2", "G2", "G2", "G3", "G3", "G3"];
    const categories = ["C1", "C1", "C1", "C1", "C2", "C2", "C2", "C3", "C3", "C3"];
    const holdings = geographies.map((geo, i) =>
      makeHolding({ symbol: `H${i}`, currentValue: 100, geography: geo, category: categories[i] }),
    );
    expect(checkLimitBreaches(holdings)).toEqual([]);
  });
});

describe("runStressTest", () => {
  it("applies a uniform shock to equity but leaves cash untouched", () => {
    const holdings = [makeHolding({ symbol: "A", currentValue: 1000 })];
    const result = runStressTest(holdings, { liquid: 500, vault: 0 }, -20);
    expect(result.totalEquityAfter).toBe(800);
    expect(result.totalPortfolioBefore).toBe(1500);
    expect(result.totalPortfolioAfter).toBe(1300); // 800 equity + 500 cash
    expect(result.totalLoss).toBe(200);
  });
});

// --- Fake SupabaseClient for testing compareToBenchmark/getRiskMetrics -----
//
// Mimics the .from(table).select().eq().order().limit() / .single() chain
// used by portfolio-data.ts, backed by an in-memory table of rows (or a
// simulated query error, e.g. to reproduce benchmark_history missing).
type FakeTable = { rows: Record<string, unknown>[] } | { error: string };

function makeQueryBuilder(table: FakeTable) {
  if ("error" in table) {
    const err = { data: null, error: { message: table.error } };
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => Promise.resolve(err),
      then: (resolve: any) => Promise.resolve(err).then(resolve),
    };
    return builder;
  }

  let rows = [...table.rows];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      const asc = opts?.ascending !== false;
      rows = [...rows].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av === bv) return 0;
        return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
      return builder;
    },
    limit: (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return builder;
}

function makeFakeSb(tables: Record<string, FakeTable>): SupabaseClient {
  return { from: (table: string) => makeQueryBuilder(tables[table] || { rows: [] }) } as unknown as SupabaseClient;
}

describe("buildBenchmarkCompareNote", () => {
  it("returns undefined when both series have enough history", () => {
    expect(buildBenchmarkCompareNote(10, 10, "NIFTY50")).toBeUndefined();
  });

  it("points at fetch-benchmark-prices when only the benchmark is short", () => {
    const note = buildBenchmarkCompareNote(10, 0, "NIFTY50");
    expect(note).toContain("NIFTY50");
    expect(note).toContain("fetch-benchmark-prices");
  });

  it("mentions net_worth_history when only the portfolio series is short", () => {
    expect(buildBenchmarkCompareNote(1, 10, "NIFTY50")).toBe("Insufficient history in net_worth_history for this window.");
  });

  it("mentions both sources when neither has enough history", () => {
    const note = buildBenchmarkCompareNote(0, 0, "NIFTY50");
    expect(note).toContain("net_worth_history");
    expect(note).toContain("NIFTY50");
  });
});

describe("compareToBenchmark", () => {
  const holdings: Holding[] = [];

  it("computes portfolio vs. benchmark return when both series have data", async () => {
    const sb = makeFakeSb({
      net_worth_history: {
        rows: [
          { recorded_at: "2026-01-01", portfolio_value: 100000 },
          { recorded_at: "2026-02-01", portfolio_value: 110000 },
        ],
      },
      benchmark_history: {
        rows: [
          { symbol: "NIFTY50", date: "2026-01-01", close: 20000 },
          { symbol: "NIFTY50", date: "2026-02-01", close: 21000 },
        ],
      },
    });
    const result = await compareToBenchmark(sb, holdings, "NIFTY50", 90);
    expect(result.portfolioReturnPercent).toBeCloseTo(10);
    expect(result.benchmarkReturnPercent).toBeCloseTo(5);
    expect(result.outperformancePercent).toBeCloseTo(5);
    expect(result.note).toBeUndefined();
  });

  it("degrades gracefully (no throw, clear note) when benchmark_history has no rows for the symbol", async () => {
    const sb = makeFakeSb({
      net_worth_history: {
        rows: [
          { recorded_at: "2026-01-01", portfolio_value: 100000 },
          { recorded_at: "2026-02-01", portfolio_value: 110000 },
        ],
      },
      benchmark_history: { rows: [] },
    });
    const result = await compareToBenchmark(sb, holdings, "NIFTY50", 90);
    expect(result.benchmarkReturnPercent).toBeNull();
    expect(result.outperformancePercent).toBeNull();
    expect(result.note).toContain("fetch-benchmark-prices");
  });

  it("degrades gracefully (no throw) when the benchmark_history query itself errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeFakeSb({
      net_worth_history: {
        rows: [
          { recorded_at: "2026-01-01", portfolio_value: 100000 },
          { recorded_at: "2026-02-01", portfolio_value: 110000 },
        ],
      },
      benchmark_history: { error: 'relation "public.benchmark_history" does not exist' },
    });
    const result = await compareToBenchmark(sb, holdings, "NIFTY50", 90);
    expect(result.benchmarkReturnPercent).toBeNull();
    expect(result.note).toContain("fetch-benchmark-prices");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("getRiskMetrics", () => {
  const holdings: Holding[] = [makeHolding({ symbol: "AAPL", currentValue: 1000 })];
  const historicalRows = Array.from({ length: 30 }, (_, i) => ({
    symbol: "AAPL",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    close: 100 + i,
  }));

  it("reports null beta (not a misleading 0.00) when benchmark_history has no NIFTY50 data", async () => {
    const sb = makeFakeSb({
      historical_prices: { rows: historicalRows },
      benchmark_history: { rows: [] },
    });
    const result = await getRiskMetrics(sb, holdings, 30);
    expect(result.portfolioBetaVsNifty50).toBeNull();
    expect(result.perHolding[0].beta).toBeNull();
    expect(result.note).toContain("fetch-benchmark-prices");
    // Volatility is still computed from historical_prices alone.
    expect(result.portfolioAnnualizedVolatilityPercent).toBeGreaterThan(0);
  });

  it("computes a real beta once benchmark_history has matching data", async () => {
    const benchRows = Array.from({ length: 30 }, (_, i) => ({
      symbol: "NIFTY50",
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 20000 + i * 10,
    }));
    const sb = makeFakeSb({
      historical_prices: { rows: historicalRows },
      benchmark_history: { rows: benchRows },
    });
    const result = await getRiskMetrics(sb, holdings, 30);
    expect(result.portfolioBetaVsNifty50).not.toBeNull();
    expect(typeof result.portfolioBetaVsNifty50).toBe("number");
    expect(result.note).not.toContain("not available");
  });
});
