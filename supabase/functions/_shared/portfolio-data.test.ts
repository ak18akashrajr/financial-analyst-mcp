import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBenchmarkCompareNote,
  buildFYPeriods,
  checkLimitBreaches,
  compareToBenchmark,
  computeHoldingsFromTxns,
  concentrationRisk,
  exposureBy,
  fyStartYearFromDate,
  getCurrentPortfolio,
  getExposureDrift,
  getPeriodPerformance,
  getPortfolioValueAsOf,
  getRiskMetrics,
  listTransactions,
  resolveFYPeriod,
  runStressTest,
  splitByPriceAvailability,
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

  it("marks a symbol missing from priceMap as hasPriceData: false instead of a fabricated 100% loss", () => {
    // TCS has no entry in this priceMap (e.g. current_prices hasn't synced it yet).
    const holdings = computeHoldingsFromTxns(txns, { AAPL: 150 }, META);
    const aapl = holdings.find((h) => h.symbol === "AAPL")!;
    expect(aapl.hasPriceData).toBe(true);
    // TCS is fully closed in this txn set regardless, so re-check with an open TCS position.
    const openTcsTxns: Txn[] = [{ symbol: "TCS", type: "BUY", quantity: 5, price: 200, date: "2026-01-15" }];
    const tcs = computeHoldingsFromTxns(openTcsTxns, {}, META)[0];
    expect(tcs.hasPriceData).toBe(false);
    expect(tcs.currentValue).toBe(0);
    expect(tcs.pnl).toBe(0); // not -1000 (a fabricated 100% loss)
    expect(tcs.invested).toBe(1000); // invested amount is still real and unaffected
  });
});

describe("splitByPriceAvailability", () => {
  it("separates priced holdings from those missing a price", () => {
    const priced = makeHolding({ symbol: "A", hasPriceData: true });
    const unpriced = makeHolding({ symbol: "B", hasPriceData: false });
    const result = splitByPriceAvailability([priced, unpriced]);
    expect(result.priced).toEqual([priced]);
    expect(result.missingSymbols).toEqual(["B"]);
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
    hasPriceData: true,
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
    const result = runStressTest(holdings, { liquid: 500, vault: 0, pf: 0, creditCardDebt: 0 }, -20);
    expect(result.totalEquityAfter).toBe(800);
    expect(result.totalPortfolioBefore).toBe(1500);
    expect(result.totalPortfolioAfter).toBe(1300); // 800 equity + 500 cash
    expect(result.totalLoss).toBe(200);
  });

  it("carries PF balance and credit card debt through unchanged, same as liquid/vault cash", () => {
    const holdings = [makeHolding({ symbol: "A", currentValue: 1000 })];
    const result = runStressTest(holdings, { liquid: 500, vault: 0, pf: 300, creditCardDebt: 200 }, -20);
    // Before: 1000 equity + 500 liquid + 300 PF - 200 debt = 1600
    expect(result.totalPortfolioBefore).toBe(1600);
    // After: 800 equity + 500 liquid + 300 PF - 200 debt = 1400
    expect(result.totalPortfolioAfter).toBe(1400);
    expect(result.totalLoss).toBe(200); // the equity loss only — PF/debt didn't move
  });

  it("reports totalLossPercent — the net-worth decline, not the shocked holding's own drop", () => {
    const holdings = [makeHolding({ symbol: "A", currentValue: 1000 })];
    const result = runStressTest(holdings, { liquid: 500, vault: 0, pf: 0, creditCardDebt: 0 }, -20);
    // 200 loss / 1500 total portfolio before = 13.33%, diluted well below the holding's own 20%.
    expect(result.totalLossPercent).toBe(13.33);
  });

  it("shocks only the given symbols, leaving every other holding untouched", () => {
    const holdings = [
      makeHolding({ symbol: "A", currentValue: 1000 }),
      makeHolding({ symbol: "B", currentValue: 500 }),
    ];
    const result = runStressTest(holdings, { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 }, -20, ["A"]);
    const a = result.holdings.find((h) => h.symbol === "A")!;
    const b = result.holdings.find((h) => h.symbol === "B")!;
    expect(a.shockedValue).toBe(800); // 1000 * 0.8
    expect(a.loss).toBe(200);
    expect(b.shockedValue).toBe(500); // untouched
    expect(b.loss).toBe(0);
    // Before: 1500. After: 800 (shocked A) + 500 (untouched B) = 1300.
    expect(result.totalPortfolioBefore).toBe(1500);
    expect(result.totalPortfolioAfter).toBe(1300);
    expect(result.totalLoss).toBe(200);
    expect(result.shockedSymbols).toEqual(["A"]);
  });

  it("omits shockedSymbols entirely for a uniform (no-filter) shock", () => {
    const holdings = [makeHolding({ symbol: "A", currentValue: 1000 })];
    const result = runStressTest(holdings, { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 }, -20);
    expect(result).not.toHaveProperty("shockedSymbols");
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
    in: (col: string, vals: unknown[]) => {
      const set = new Set(vals);
      rows = rows.filter((r) => set.has(r[col]));
      return builder;
    },
    lte: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r[col] as string | number) <= (val as string | number));
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

describe("getCurrentPortfolio", () => {
  it("excludes a symbol with no current_prices row from totals and flags it, rather than pricing it at ₹0", async () => {
    const sb = makeFakeSb({
      transactions: {
        rows: [
          { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-01-01" },
          { symbol: "HDFC", type: "BUY", quantity: 5, price: 200, date: "2026-01-01" },
        ],
      },
      current_prices: { rows: [{ symbol: "TCS", price: 150 }] }, // HDFC missing
      symbol_metadata: {
        rows: [
          { symbol: "TCS", geography: "India", sector: "Tech" },
          { symbol: "HDFC", geography: "India", sector: "Financials" },
        ],
      },
      cash_settings: { rows: [{ liquid_cash: 1000, vault_cash: 0 }] },
    });
    const p = await getCurrentPortfolio(sb);
    expect(p.holdings.map((h) => h.symbol)).toEqual(["TCS"]);
    expect(p.missingPriceSymbols).toEqual(["HDFC"]);
    // Totals reflect only the priced holding + cash — HDFC's ₹1000 invested is
    // not silently counted as a ₹1000 loss.
    expect(p.totalInvested).toBe(1000); // TCS only: 10 * 100
    expect(p.totalCurrentValue).toBe(1500); // TCS only: 10 * 150
    expect(p.totalPortfolioValue).toBe(2500); // 1500 + 1000 cash
  });

  it("includes PF balance and subtracts credit card debt from totalPortfolioValue, matching the frontend's net-worth formula", async () => {
    const sb = makeFakeSb({
      transactions: {
        rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-01-01" }],
      },
      current_prices: { rows: [{ symbol: "TCS", price: 150 }] },
      symbol_metadata: { rows: [{ symbol: "TCS", geography: "India", sector: "Tech" }] },
      cash_settings: {
        rows: [{ liquid_cash: 1000, vault_cash: 0, pf_balance: 5000, credit_card_debt: 2000 }],
      },
    });
    const p = await getCurrentPortfolio(sb);
    expect(p.cash).toEqual({ liquid: 1000, vault: 0, pf: 5000, creditCardDebt: 2000 });
    // 1500 (TCS) + 1000 liquid + 0 vault + 5000 PF - 2000 debt = 5500
    expect(p.totalPortfolioValue).toBe(5500);
  });
});

describe("getExposureDrift", () => {
  const txns = {
    rows: [
      { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-01-01" },
      // Bought before asOfDate, so it IS held as of asOfDate — the gap being
      // tested is a missing historical_prices row, not "not yet owned".
      { symbol: "HDFC", type: "BUY", quantity: 10, price: 100, date: "2026-01-05" },
    ],
  };
  const meta = {
    rows: [
      { symbol: "TCS", geography: "India", sector: "Tech" },
      { symbol: "HDFC", geography: "India", sector: "Financials" },
    ],
  };

  it("excludes a symbol with no historical_prices row on/before asOfDate from the past side, instead of a fake 0% drift", async () => {
    const sb = makeFakeSb({
      transactions: txns,
      current_prices: { rows: [{ symbol: "TCS", price: 150 }, { symbol: "HDFC", price: 120 }] },
      symbol_metadata: meta,
      // Only TCS has history on/before the asOfDate — HDFC was bought after it,
      // so it has no historical_prices row that old.
      historical_prices: { rows: [{ symbol: "TCS", date: "2026-01-01", close: 100 }] },
    });
    const result = await getExposureDrift(sb, "2026-01-15");
    // Past-side sector exposure should be 100% Tech (TCS only) — HDFC excluded
    // rather than contributing a fabricated 0%-weight "Financials" data point.
    const techDrift = result.categoryDrift.find((d) => d.label === "Tech")!;
    expect(techDrift.pastPercent).toBe(100);
    expect(result.note).toContain("HDFC");
    expect(result.note).toContain("excluded from past-side exposure");
  });
});

describe("getPortfolioValueAsOf", () => {
  const meta = { rows: [{ symbol: "TCS", geography: "India", sector: "Tech" }] };

  it("prices holdings at the closest historical close on/before asOfDate and pulls cash from the closest net_worth_history snapshot, never live values", async () => {
    const sb = makeFakeSb({
      transactions: {
        rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2025-06-01" }],
      },
      symbol_metadata: meta,
      historical_prices: {
        rows: [
          { symbol: "TCS", date: "2025-07-31", close: 120 }, // closest close on/before asOfDate
          { symbol: "TCS", date: "2026-08-20", close: 999 }, // must NOT leak into a 2025 valuation
        ],
      },
      net_worth_history: {
        rows: [
          { recorded_at: "2025-07-31", liquid_cash: 500, vault_cash: 0, pf_balance: 1000, credit_card_debt: 0 },
          { recorded_at: "2026-08-20", liquid_cash: 999999, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 },
        ],
      },
    });

    const result = await getPortfolioValueAsOf(sb, "2025-07-31");

    expect(result.equityValue).toBe(1200); // 10 * 120
    expect(result.liquidCash).toBe(500);
    expect(result.pfBalance).toBe(1000);
    expect(result.portfolioValue).toBe(2700); // 1200 + 500 + 1000
  });

  it("excludes a symbol with no historical_prices row on/before asOfDate rather than pricing it at ₹0, and flags absent net_worth_history", async () => {
    const sb = makeFakeSb({
      transactions: {
        rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2025-06-01" }],
      },
      symbol_metadata: meta,
      historical_prices: { rows: [] }, // no history at all
      net_worth_history: { rows: [] },
    });

    const result = await getPortfolioValueAsOf(sb, "2025-07-31");

    expect(result.equityValue).toBe(0); // TCS excluded, not counted as a ₹0/full loss
    expect(result.portfolioValue).toBe(0);
    expect(result.note).toContain("TCS");
    expect(result.note).toContain("No net_worth_history snapshot");
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

  it("fetches historical_prices for every holding in a single batched query, not one per holding", async () => {
    const multiHoldings: Holding[] = [
      makeHolding({ symbol: "AAPL", currentValue: 1000 }),
      makeHolding({ symbol: "TCS", currentValue: 2000 }),
      makeHolding({ symbol: "HDFC", currentValue: 3000 }),
    ];
    const multiRows = ["AAPL", "TCS", "HDFC"].flatMap((symbol) =>
      Array.from({ length: 30 }, (_, i) => ({
        symbol,
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        close: 100 + i,
      })),
    );
    const sb = makeFakeSb({ historical_prices: { rows: multiRows }, benchmark_history: { rows: [] } });
    const fromSpy = vi.fn(sb.from.bind(sb));
    (sb as any).from = fromSpy;

    await getRiskMetrics(sb, multiHoldings, 30);

    const historicalPriceCalls = fromSpy.mock.calls.filter(([table]) => table === "historical_prices");
    expect(historicalPriceCalls.length).toBe(1);
  });

  it("keeps each holding's return series correctly separated after a batched fetch", async () => {
    const multiHoldings: Holding[] = [
      makeHolding({ symbol: "AAPL", currentValue: 1000 }),
      makeHolding({ symbol: "TCS", currentValue: 1000 }),
    ];
    // AAPL: flat prices -> zero daily returns -> zero volatility. TCS: an
    // erratic up/down swing each day -> genuinely varying daily returns, so
    // its standard deviation (and therefore annualized volatility) is
    // nonzero — a smooth constant-percentage trend would NOT work here,
    // since every daily return would be identical and stdDev would still be 0.
    const tcsCloses = [100, 110, 95, 120, 90, 130, 85, 140, 80, 150];
    const multiRows = [
      ...Array.from({ length: 10 }, (_, i) => ({ symbol: "AAPL", date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 })),
      ...tcsCloses.map((close, i) => ({ symbol: "TCS", date: `2026-01-${String(i + 1).padStart(2, "0")}`, close })),
    ];
    const sb = makeFakeSb({ historical_prices: { rows: multiRows }, benchmark_history: { rows: [] } });

    const result = await getRiskMetrics(sb, multiHoldings, 10);

    const aapl = result.perHolding.find((h) => h.symbol === "AAPL")!;
    const tcs = result.perHolding.find((h) => h.symbol === "TCS")!;
    expect(aapl.annualizedVolatilityPercent).toBe(0);
    expect(tcs.annualizedVolatilityPercent).toBeGreaterThan(0);
  });
});

describe("fyStartYearFromDate / buildFYPeriods", () => {
  it("attributes a date before April to the previous FY", () => {
    expect(fyStartYearFromDate("2026-03-31")).toBe(2025);
    expect(fyStartYearFromDate("2026-04-01")).toBe(2026);
  });

  it("builds four contiguous, non-overlapping quarters spanning the full FY", () => {
    const quarters = buildFYPeriods(2026, "quarter");
    expect(quarters).toHaveLength(4);
    expect(quarters[0].start).toBe("2026-04-01");
    expect(quarters[3].end).toBe("2027-04-01");
    for (let i = 1; i < quarters.length; i++) {
      expect(quarters[i].start).toBe(quarters[i - 1].end); // contiguous, no gap/overlap
    }
  });

  it("builds two halves and a single full year", () => {
    expect(buildFYPeriods(2026, "half")).toHaveLength(2);
    const fy = buildFYPeriods(2026, "year");
    expect(fy).toHaveLength(1);
    expect(fy[0].start).toBe("2026-04-01");
    expect(fy[0].end).toBe("2027-04-01");
  });
});

describe("resolveFYPeriod", () => {
  it("defaults to whichever quarter contains today when no explicit period is given", () => {
    const p = resolveFYPeriod("2026-08-23", "quarter");
    expect(p.key).toBe("FY2026-27-Q2"); // Aug falls in Jul-Sep
  });

  it("honors an explicit periodIndex within an explicit fyStartYear", () => {
    const p = resolveFYPeriod("2026-08-23", "quarter", 2025, 4);
    expect(p.key).toBe("FY2025-26-Q4");
  });

  it("throws for a periodIndex out of range for the period type", () => {
    expect(() => resolveFYPeriod("2026-08-23", "half", undefined, 3)).toThrow(/periodIndex must be between 1 and 2/);
  });

  it("falls back to the FY's last period when an explicit past fyStartYear has no periodIndex", () => {
    const p = resolveFYPeriod("2026-08-23", "quarter", 2020);
    expect(p.key).toBe("FY2020-21-Q4");
  });
});

describe("getPeriodPerformance", () => {
  const meta = {
    rows: [{ symbol: "TCS", geography: "India", sector: "Tech" }],
  };

  it("reports the raw net-worth delta as totalChange, without double-counting a mid-period buy funded from already-tracked cash", async () => {
    const txns = {
      rows: [
        // Bought before the quarter — establishes the start-of-period position.
        { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-06-01" },
        // Bought mid-quarter, funded from the portfolio's own tracked cash — a pure
        // reallocation, not new external money, so it must NOT be subtracted from totalChange
        // (that would double-count it as a phantom loss — see the getPortfolioSummary vs.
        // Reports.tsx cross-check that caught this bug).
        { symbol: "TCS", type: "BUY", quantity: 5, price: 150, date: "2026-08-01" },
      ],
    };
    const sb = makeFakeSb({
      transactions: txns,
      symbol_metadata: meta,
      // Historical close on/before the quarter start (2026-07-01): ₹100/share.
      historical_prices: { rows: [{ symbol: "TCS", date: "2026-06-15", close: 100 }] },
      net_worth_history: { rows: [] },
    });
    const currentHoldings: Holding[] = [
      makeHolding({ symbol: "TCS", quantity: 15, currentValue: 15 * 120, hasPriceData: true }),
    ];
    const currentCash = { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 };

    const result = await getPeriodPerformance(
      sb,
      currentHoldings,
      currentCash,
      "quarter",
      2026,
      2, // Q2: Jul-Sep 2026
      new Date("2026-08-23T00:00:00Z"),
    );

    expect(result.status).toBe("in-progress");
    // Start: 10 shares held as of 2026-07-01 @ historical ₹100 = 1000.
    expect(result.startPortfolioValue).toBe(1000);
    // End: 15 shares (10 + 5 bought mid-quarter) @ live ₹120 = 1800.
    expect(result.endPortfolioValue).toBe(1800);
    // Reported for information only — money moved from cash into stock (5 * 150 = 750),
    // not subtracted from totalChange below.
    expect(result.netInvestedInPeriod).toBe(750);
    // The real return is the raw delta: 1800 - 1000 = 800, not 800 - 750 = 50.
    expect(result.totalChange).toBe(800);
    expect(result.totalChangePercent).toBeCloseTo(80); // 800 / 1000 * 100
    expect(result.buyCount).toBe(1); // only the mid-quarter buy is "in period"
  });

  it("marks a completed period entirely with historical closes, never live prices", async () => {
    const txns = {
      rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-01-01" }],
    };
    const sb = makeFakeSb({
      transactions: txns,
      symbol_metadata: meta,
      historical_prices: {
        rows: [
          { symbol: "TCS", date: "2026-03-31", close: 110 }, // last close of Q4 FY2025-26
        ],
      },
      net_worth_history: { rows: [] },
    });
    // Live price is 999 — must NOT leak into a completed period's endPortfolioValue.
    const currentHoldings: Holding[] = [makeHolding({ symbol: "TCS", quantity: 10, currentValue: 9990 })];

    const result = await getPeriodPerformance(
      sb,
      currentHoldings,
      { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 },
      "quarter",
      2025,
      4, // Q4 FY2025-26: Jan-Mar 2026 — completed relative to "today" below
      new Date("2026-08-23T00:00:00Z"),
    );

    expect(result.status).toBe("completed");
    expect(result.endPortfolioValue).toBe(1100); // 10 * 110 (historical), not 9990 (live)
  });

  it("reports an upcoming period as having no performance yet, without querying transaction data", async () => {
    const sb = makeFakeSb({});
    const result = await getPeriodPerformance(
      sb,
      [],
      { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 },
      "quarter",
      2027, // a future FY relative to "today" below
      1,
      new Date("2026-08-23T00:00:00Z"),
    );
    expect(result.status).toBe("upcoming");
    expect(result.note).toContain("hasn't started yet");
  });

  it("flags a symbol with no historical_prices row on/before the period start instead of pricing it at ₹0", async () => {
    const txns = {
      rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-06-01" }],
    };
    const sb = makeFakeSb({
      transactions: txns,
      symbol_metadata: meta,
      historical_prices: { rows: [] }, // no history at all for TCS
      net_worth_history: { rows: [] },
    });
    const result = await getPeriodPerformance(
      sb,
      [makeHolding({ symbol: "TCS", quantity: 10, currentValue: 1200 })],
      { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 },
      "quarter",
      2026,
      2,
      new Date("2026-08-23T00:00:00Z"),
    );
    expect(result.startPortfolioValue).toBe(0); // TCS excluded, not counted at ₹0 loss
    expect(result.note).toContain("TCS");
    expect(result.note).toContain("excluded from startPortfolioValue");
  });
});

describe("listTransactions", () => {
  const txns = {
    rows: [
      { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-06-15" }, // before the month
      { symbol: "TCS", type: "BUY", quantity: 5, price: 150, date: "2026-08-05" },
      { symbol: "HDFC", type: "BUY", quantity: 3, price: 200.333, date: "2026-08-10" },
      { symbol: "TCS", type: "SELL", quantity: 2, price: 160, date: "2026-08-15" },
      { symbol: "TCS", type: "BUY", quantity: 1, price: 170, date: "2026-09-01" }, // after the month
    ],
  };

  it("defaults to the current calendar month and totals buys/sells correctly", async () => {
    const sb = makeFakeSb({ transactions: txns });
    const result = await listTransactions(sb, undefined, undefined, undefined, new Date("2026-08-23T00:00:00Z"));
    expect(result.startDate).toBe("2026-08-01");
    expect(result.endDate).toBe("2026-08-23");
    expect(result.transactions.map((t) => `${t.symbol}-${t.type}-${t.date}`)).toEqual([
      "TCS-BUY-2026-08-05",
      "HDFC-BUY-2026-08-10",
      "TCS-SELL-2026-08-15",
    ]);
    expect(result.buyCount).toBe(2);
    expect(result.sellCount).toBe(1);
    expect(result.buyValue).toBe(Math.round(5 * 150 + 3 * 200.333)); // 750 + 600.999 -> 1351
    expect(result.sellValue).toBe(2 * 160);
    expect(result.netInvested).toBe(result.buyValue - result.sellValue);
    // Each transaction carries its own per-trade value, rounded to whole rupees.
    const tcsBuy = result.transactions.find((t) => t.date === "2026-08-05")!;
    expect(tcsBuy.value).toBe(750);
  });

  it("filters to a single symbol when `symbol` is passed", async () => {
    const sb = makeFakeSb({ transactions: txns });
    const result = await listTransactions(sb, "HDFC", undefined, undefined, new Date("2026-08-23T00:00:00Z"));
    expect(result.symbol).toBe("HDFC");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].symbol).toBe("HDFC");
  });

  it("honors an explicit startDate/endDate range instead of defaulting to the current month", async () => {
    const sb = makeFakeSb({ transactions: txns });
    const result = await listTransactions(sb, undefined, "2026-06-01", "2026-06-30", new Date("2026-08-23T00:00:00Z"));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date).toBe("2026-06-15");
  });
});
