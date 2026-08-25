// Tests for the TOOL_REGISTRY handlers themselves (as opposed to the
// portfolio-data.ts functions they wrap) — specifically the numeric-accuracy
// guarantees the LLM relies on: a consistent rounding convention across
// tools, and missing-price symbols surfaced as a flag rather than silently
// priced at ₹0.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findTool } from "./mcp-tools.ts";

type FakeTable = { rows: Record<string, unknown>[] };

function makeQueryBuilder(table: FakeTable) {
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
    order: (col?: string, opts?: { ascending?: boolean }) => {
      if (col) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) return 0;
          return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
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

const BASE_TABLES = {
  transactions: {
    rows: [
      { symbol: "TCS", type: "BUY", quantity: 3, price: 100.333, date: "2026-01-01" },
      { symbol: "HDFC", type: "BUY", quantity: 5, price: 200, date: "2026-01-01" },
    ],
  },
  symbol_metadata: {
    rows: [
      { symbol: "TCS", geography: "India", sector: "Tech" },
      { symbol: "HDFC", geography: "India", sector: "Financials" },
    ],
  },
  cash_settings: { rows: [{ liquid_cash: 0, vault_cash: 0 }] },
};

describe("get_portfolio_summary", () => {
  it("rounds monetary totals to whole rupees and flags a symbol missing a current price", async () => {
    const sb = makeFakeSb({
      ...BASE_TABLES,
      current_prices: { rows: [{ symbol: "TCS", price: 150.789 }] }, // HDFC missing
    });
    const result = (await findTool("get_portfolio_summary")!.handler({}, sb)) as Record<string, unknown>;
    expect(Number.isInteger(result.totalInvested)).toBe(true);
    expect(Number.isInteger(result.totalCurrentValue)).toBe(true);
    expect(result.missingPriceSymbols).toEqual(["HDFC"]);
    expect(String(result.note)).toContain("HDFC");
  });

  it("surfaces PF balance and credit card debt, and folds both into totalPortfolioValue", async () => {
    const sb = makeFakeSb({
      ...BASE_TABLES,
      current_prices: { rows: [{ symbol: "TCS", price: 150 }, { symbol: "HDFC", price: 200 }] },
      cash_settings: { rows: [{ liquid_cash: 1000, vault_cash: 0, pf_balance: 5000, credit_card_debt: 2000 }] },
    });
    const result = (await findTool("get_portfolio_summary")!.handler({}, sb)) as Record<string, unknown>;
    expect(result.pfBalance).toBe(5000);
    expect(result.creditCardDebt).toBe(2000);
    // totalCurrentValue = 3*150 + 5*200 = 1450; + 1000 liquid + 5000 PF - 2000 debt = 5450
    expect(result.totalCurrentValue).toBe(1450);
    expect(result.totalPortfolioValue).toBe(5450);
  });
});

describe("list_holdings", () => {
  it("rounds each holding to the same convention as get_portfolio_summary and reconciles with it", async () => {
    const sb = makeFakeSb({
      ...BASE_TABLES,
      current_prices: { rows: [{ symbol: "TCS", price: 150.789 }, { symbol: "HDFC", price: 210.456 }] },
    });
    const summary = (await findTool("get_portfolio_summary")!.handler({}, sb)) as { totalCurrentValue: number };
    const listResult = (await findTool("list_holdings")!.handler({}, sb)) as {
      holdings: Array<{ currentValue: number; currentPrice: number }>;
    };
    expect(listResult.holdings.every((h) => Number.isInteger(h.currentValue))).toBe(true);
    expect(listResult.holdings.every((h) => Number(h.currentPrice.toFixed(2)) === h.currentPrice)).toBe(true);
    // Summing already-rounded per-holding values can differ from the
    // independently-rounded aggregate by at most ₹1 (rounding two different
    // things), never by the kind of unbounded drift raw-vs-rounded mixing
    // used to allow.
    const summedCurrentValue = listResult.holdings.reduce((s, h) => s + h.currentValue, 0);
    expect(Math.abs(summedCurrentValue - summary.totalCurrentValue)).toBeLessThanOrEqual(1);
  });

  it("omits a symbol with no current price rather than showing a fabricated ₹0 value", async () => {
    const sb = makeFakeSb({
      ...BASE_TABLES,
      current_prices: { rows: [{ symbol: "TCS", price: 150 }] },
    });
    const result = (await findTool("list_holdings")!.handler({}, sb)) as {
      holdings: Array<{ symbol: string }>;
      missingPriceSymbols: string[];
    };
    expect(result.holdings.map((h) => h.symbol)).toEqual(["TCS"]);
    expect(result.missingPriceSymbols).toEqual(["HDFC"]);
  });
});

describe("list_transactions", () => {
  it("routes args through and returns itemized trades for an explicit date range", async () => {
    const sb = makeFakeSb({
      transactions: {
        rows: [
          { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-01-05" },
          { symbol: "HDFC", type: "BUY", quantity: 3, price: 200, date: "2026-01-10" },
          { symbol: "TCS", type: "SELL", quantity: 4, price: 120, date: "2026-02-01" }, // out of range
        ],
      },
    });
    const result = (await findTool("list_transactions")!.handler(
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      sb,
    )) as { transactions: Array<{ symbol: string }>; buyCount: number; sellCount: number };
    expect(result.transactions.map((t) => t.symbol)).toEqual(["TCS", "HDFC"]);
    expect(result.buyCount).toBe(2);
    expect(result.sellCount).toBe(0);
  });
});

describe("get_period_performance", () => {
  it("routes args through to getPeriodPerformance and marks a completed period with historical closes", async () => {
    // FY2020-21 Q4 (Jan-Mar 2021) is guaranteed to be "completed" regardless of
    // wall-clock time when this test runs, so the test doesn't depend on today's date.
    const sb = makeFakeSb({
      transactions: {
        rows: [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2020-06-01" }],
      },
      symbol_metadata: { rows: [{ symbol: "TCS", geography: "India", sector: "Tech" }] },
      current_prices: { rows: [{ symbol: "TCS", price: 999 }] }, // must not leak into a completed period
      cash_settings: { rows: [{ liquid_cash: 0, vault_cash: 0 }] },
      historical_prices: { rows: [{ symbol: "TCS", date: "2021-03-31", close: 130 }] },
      net_worth_history: { rows: [] },
    });
    const result = (await findTool("get_period_performance")!.handler(
      { periodType: "quarter", fyStartYear: 2020, periodIndex: 4 },
      sb,
    )) as Record<string, unknown>;
    expect(result.status).toBe("completed");
    expect(result.periodKey).toBe("FY2020-21-Q4");
    expect(result.endPortfolioValue).toBe(1300); // 10 * 130 (historical), not 999 (live)
  });

  it("rejects a periodIndex out of range for the requested periodType", async () => {
    const sb = makeFakeSb({});
    await expect(
      findTool("get_period_performance")!.handler({ periodType: "half", periodIndex: 3 }, sb),
    ).rejects.toThrow(/periodIndex must be between 1 and 2/);
  });
});

describe("run_stress_test", () => {
  it("shocks only the requested symbol when `symbols` is passed, not the whole portfolio", async () => {
    const sb = makeFakeSb({
      ...BASE_TABLES,
      current_prices: { rows: [{ symbol: "TCS", price: 100 }, { symbol: "HDFC", price: 200 }] },
    });
    const result = (await findTool("run_stress_test")!.handler(
      { shockPercent: -20, symbols: ["TCS"] },
      sb,
    )) as {
      holdings: Array<{ symbol: string; currentValue: number; shockedValue: number; loss: number }>;
      shockedSymbols: string[];
      totalLossPercent: number;
    };
    const tcs = result.holdings.find((h) => h.symbol === "TCS")!;
    const hdfc = result.holdings.find((h) => h.symbol === "HDFC")!;
    // TCS: 3 * 100 = 300 currentValue, shocked -20% -> 240.
    expect(tcs.currentValue).toBe(300);
    expect(tcs.shockedValue).toBe(240);
    expect(tcs.loss).toBe(60);
    // HDFC: 5 * 200 = 1000, untouched since it's not in `symbols`.
    expect(hdfc.currentValue).toBe(1000);
    expect(hdfc.shockedValue).toBe(1000);
    expect(hdfc.loss).toBe(0);
    expect(result.shockedSymbols).toEqual(["TCS"]);
    // Total portfolio before = 1300 (300+1000, no cash in BASE_TABLES); loss is just TCS's ₹60.
    expect(result.totalLossPercent).toBeCloseTo((60 / 1300) * 100, 2);
  });
});
