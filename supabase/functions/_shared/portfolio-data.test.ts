import { describe, expect, it } from "vitest";
import {
  checkLimitBreaches,
  computeHoldingsFromTxns,
  concentrationRisk,
  exposureBy,
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
