// Central registry of portfolio tools exposed over MCP.
//
// Shared by two consumers that both live in this repo:
//  - portfolio-mcp-server: serves this registry over the real MCP protocol
//    (tools/list, tools/call) so any MCP client (ours or a third party) can
//    use it.
//  - portfolio-ai: imports `complexity` directly from this file (not over
//    the wire) purely for the cheap Groq gpt-oss-20b/120b routing heuristic
//    in Phase 3 — that's a same-repo implementation shortcut, not part of
//    the MCP protocol itself. Tool *execution* from portfolio-ai always goes
//    through a real MCP tools/call request, never a direct function call.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import {
  checkLimitBreaches,
  compareToBenchmark,
  concentrationRisk,
  exposureBy,
  getCurrentPortfolio,
  getExposureDrift,
  getRiskMetrics,
  runStressTest,
  type Holding,
} from "./portfolio-data.ts";

/** Rounds a holding's monetary fields to whole rupees and rates/percentages to
 * 2 decimals — the single rounding convention every tool in this registry
 * uses, so the model never sees two different precisions for "the same"
 * number across tool calls and is never tempted to re-derive one from the
 * other. */
function roundHolding(h: Holding) {
  return {
    ...h,
    avgPrice: Number(h.avgPrice.toFixed(2)),
    currentPrice: Number(h.currentPrice.toFixed(2)),
    invested: Math.round(h.invested),
    currentValue: Math.round(h.currentValue),
    pnl: Math.round(h.pnl),
    pnlPercent: Number(h.pnlPercent.toFixed(2)),
  };
}

/** Common `missingPriceSymbols`/`note` fields, only present when non-empty. */
function missingPriceFields(missingPriceSymbols: string[], omittedFrom: string) {
  if (missingPriceSymbols.length === 0) return {};
  return {
    missingPriceSymbols,
    note:
      `No current price available for ${missingPriceSymbols.join(", ")} — ${omittedFrom} rather than shown as a fabricated ₹0 value or 100% loss.`,
  };
}

export type ToolComplexity = "simple" | "complex";

export interface ToolDefinition {
  name: string;
  description: string;
  complexity: ToolComplexity;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, sb: SupabaseClient) => Promise<unknown>;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "get_portfolio_summary",
    description:
      "High-level snapshot: total invested, current value, P&L, cash, and total portfolio value. " +
      "All monetary figures are rounded to the nearest rupee, percentages to 2 decimals — these are " +
      "the authoritative totals; do not re-derive them by summing list_holdings yourself, since a " +
      "symbol missing a current price is excluded here (see missingPriceSymbols) rather than priced at ₹0.",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return {
        totalInvested: Math.round(p.totalInvested),
        totalCurrentValue: Math.round(p.totalCurrentValue),
        totalPnl: Math.round(p.totalPnl),
        totalPnlPercent: p.totalInvested !== 0 ? Number(((p.totalPnl / p.totalInvested) * 100).toFixed(2)) : 0,
        liquidCash: Math.round(p.cash.liquid),
        vaultCash: Math.round(p.cash.vault),
        totalPortfolioValue: Math.round(p.totalPortfolioValue),
        holdingsCount: p.holdings.length,
        ...missingPriceFields(p.missingPriceSymbols, "excluded from every total above"),
      };
    },
  },
  {
    name: "list_holdings",
    description:
      "All current positions with quantity, average price, current price, value, and P&L. Monetary " +
      "values are rounded to the nearest rupee, prices and percentages to 2 decimals — the same " +
      "convention get_portfolio_summary uses (summing these rounded per-holding values may differ " +
      "from get_portfolio_summary's totals by at most ₹1 due to independent rounding).",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return {
        holdings: p.holdings.map(roundHolding),
        ...missingPriceFields(p.missingPriceSymbols, "omitted from this list"),
      };
    },
  },
  {
    name: "get_exposure_by_geography",
    description: "Portfolio exposure breakdown by geography (e.g. India vs. US), value and percent.",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return { exposure: exposureBy(p.holdings, "geography") };
    },
  },
  {
    name: "get_exposure_by_category",
    description: "Portfolio exposure breakdown by sector/category, value and percent.",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return { exposure: exposureBy(p.holdings, "category") };
    },
  },
  {
    name: "get_concentration_risk",
    description: "Top-N holdings by weight and their combined concentration percentage.",
    complexity: "simple",
    inputSchema: {
      type: "object",
      properties: { topN: { type: "number", description: "Number of top holdings to return (default 5)" } },
      additionalProperties: false,
    },
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const topN = typeof args.topN === "number" && args.topN > 0 ? args.topN : 5;
      return concentrationRisk(p.holdings, topN);
    },
  },
  {
    name: "get_risk_metrics",
    description:
      "Per-holding and portfolio-level annualized volatility and beta vs. NIFTY 50, estimated from historical prices.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: { lookbackDays: { type: "number", description: "History window in days (default 90)" } },
      additionalProperties: false,
    },
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const lookbackDays = typeof args.lookbackDays === "number" && args.lookbackDays > 0 ? args.lookbackDays : 90;
      return getRiskMetrics(sb, p.holdings, lookbackDays);
    },
  },
  {
    name: "run_stress_test",
    description: "Simulate a uniform market shock (e.g. -20%, -35%, -50%) across all current holdings.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        shockPercent: {
          type: "number",
          description: "Percent shock to apply, negative for a crash (e.g. -20 for a 20% drop).",
        },
      },
      required: ["shockPercent"],
      additionalProperties: false,
    },
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const shockPercent = Number(args.shockPercent);
      if (!Number.isFinite(shockPercent)) throw new Error("shockPercent must be a number");
      return runStressTest(p.holdings, p.cash, shockPercent);
    },
  },
  {
    name: "check_limit_breaches",
    description:
      "Flags any single holding over 15%, top-5 combined over 50%, or any sector/geography over 40% of the portfolio.",
    complexity: "complex",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return { breaches: checkLimitBreaches(p.holdings) };
    },
  },
  {
    name: "compare_to_benchmark",
    description: "Compares the portfolio's total return over a window against a benchmark index (e.g. NIFTY50).",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        benchmarkSymbol: { type: "string", description: "Benchmark symbol, e.g. NIFTY50, NIFTY500, SPX (default NIFTY50)" },
        days: { type: "number", description: "Comparison window in days (default 90)" },
      },
      additionalProperties: false,
    },
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const benchmarkSymbol = typeof args.benchmarkSymbol === "string" && args.benchmarkSymbol ? args.benchmarkSymbol : "NIFTY50";
      const days = typeof args.days === "number" && args.days > 0 ? args.days : 90;
      return compareToBenchmark(sb, p.holdings, benchmarkSymbol, days);
    },
  },
  {
    name: "get_exposure_drift",
    description: "Compares current geography/category exposure percentages against a past date.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: { asOfDate: { type: "string", description: "Past date to compare against, format YYYY-MM-DD" } },
      required: ["asOfDate"],
      additionalProperties: false,
    },
    handler: async (args, sb) => {
      const asOfDate = String(args.asOfDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error("asOfDate must be in YYYY-MM-DD format");
      return getExposureDrift(sb, asOfDate);
    },
  },
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
