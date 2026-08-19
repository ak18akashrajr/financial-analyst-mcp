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
    order: () => builder,
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
