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
  getPeriodPerformance,
  getPortfolioValueAsOf,
  getRiskMetrics,
  listTransactions,
  runStressTest,
  type Holding,
  type PeriodType,
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

/** MCP tool annotation hints (spec 2025-06-18) telling any client — ours or a
 * third party's — what a tool call can do without needing to inspect its
 * implementation. Every tool in this registry is a read-only DB query, so
 * every entry sets the same three hints; this is metadata about the
 * registry's actual behavior, not a per-tool decision. */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

export interface ToolDefinition {
  name: string;
  description: string;
  complexity: ToolComplexity;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, sb: SupabaseClient) => Promise<unknown>;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "get_portfolio_summary",
    description:
      "High-level snapshot: total invested, current value, P&L, cash, PF balance, credit card debt, " +
      "and total portfolio value (net worth — holdings + liquid + vault + PF, minus credit card debt). " +
      "All monetary figures are rounded to the nearest rupee, percentages to 2 decimals — these are " +
      "the authoritative totals; do not re-derive them by summing list_holdings yourself, since a " +
      "symbol missing a current price is excluded here (see missingPriceSymbols) rather than priced at ₹0.",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return {
        totalInvested: Math.round(p.totalInvested),
        totalCurrentValue: Math.round(p.totalCurrentValue),
        totalPnl: Math.round(p.totalPnl),
        totalPnlPercent: p.totalInvested !== 0 ? Number(((p.totalPnl / p.totalInvested) * 100).toFixed(2)) : 0,
        liquidCash: Math.round(p.cash.liquid),
        vaultCash: Math.round(p.cash.vault),
        pfBalance: Math.round(p.cash.pf),
        creditCardDebt: Math.round(p.cash.creditCardDebt),
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
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (_args, sb) => {
      const p = await getCurrentPortfolio(sb);
      return {
        holdings: p.holdings.map(roundHolding),
        ...missingPriceFields(p.missingPriceSymbols, "omitted from this list"),
      };
    },
  },
  {
    name: "list_transactions",
    description:
      "Itemized buy/sell transaction history within a date range — one row per trade (symbol, type, " +
      "quantity, price, date, value) — as opposed to list_holdings' aggregated per-symbol positions or " +
      "get_period_performance's buyCount/sellCount-only summary. Use this for \"what did I buy/sell " +
      "this month\", \"list my trades in January\", or \"show me every TCS transaction\" — questions " +
      "that need the individual trades, not a rolled-up total. The transactions table lives in this " +
      "app's own Supabase database (not a brokerage), so this data is genuinely available — never " +
      "decline a transaction-history question by claiming no access to it. Defaults to the current " +
      "calendar month (1st through today) if no startDate/endDate is given, since get_period_performance " +
      "only supports FY quarter/half/year granularity, not calendar months.",
    complexity: "simple",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", minLength: 1, description: "Optional: only this symbol's transactions" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive start date, format YYYY-MM-DD (default: 1st of the current calendar month)" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive end date, format YYYY-MM-DD (default: today)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const symbol = typeof args.symbol === "string" ? args.symbol : undefined;
      const startDate = typeof args.startDate === "string" ? args.startDate : undefined;
      const endDate = typeof args.endDate === "string" ? args.endDate : undefined;
      return listTransactions(sb, symbol, startDate, endDate);
    },
  },
  {
    name: "get_exposure_by_geography",
    description: "Portfolio exposure breakdown by geography (e.g. India vs. US), value and percent.",
    complexity: "simple",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
      properties: {
        topN: { type: "number", minimum: 1, description: "Number of top holdings to return (default 5)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      // args.topN, if present, is already a validated number >= 1 by the time
      // it reaches here — see validateArgs in mcp-schema-validate.ts, invoked
      // by portfolio-mcp-server before any handler runs.
      const topN = typeof args.topN === "number" ? args.topN : 5;
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
      properties: {
        lookbackDays: { type: "number", minimum: 1, description: "History window in days (default 90)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const lookbackDays = typeof args.lookbackDays === "number" ? args.lookbackDays : 90;
      return getRiskMetrics(sb, p.holdings, lookbackDays);
    },
  },
  {
    name: "run_stress_test",
    description:
      "Simulate a market shock (e.g. -20%, -35%, -50%). By default it applies uniformly to every " +
      "current holding; pass `symbols` to shock only those holdings instead (e.g. \"what if just " +
      "NIFTYBEES.NS dropped 20%?\") while every other holding is carried through at its current " +
      "value. Always use `symbols` for a single-holding or subset what-if question — do not call " +
      "this with no `symbols` and then subtract a partial shock yourself; the returned " +
      "totalPortfolioAfter/totalLoss/totalLossPercent are already computed correctly against the " +
      "whole portfolio (including cash, PF balance, and credit card debt, all carried through " +
      "unchanged) and must be copied as-is, per the numeric-fidelity rule.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        shockPercent: {
          type: "number",
          description: "Percent shock to apply, negative for a crash (e.g. -20 for a 20% drop).",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            "Optional: shock only these holding symbols instead of every current holding. " +
            "Symbols not listed here are left unshocked, not excluded from the totals.",
        },
      },
      required: ["shockPercent"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const shockPercent = args.shockPercent as number;
      const symbols = Array.isArray(args.symbols) ? (args.symbols as string[]) : undefined;
      return runStressTest(p.holdings, p.cash, shockPercent, symbols);
    },
  },
  {
    name: "check_limit_breaches",
    description:
      "Flags any single holding over 15%, top-5 combined over 50%, or any sector/geography over 40% of the portfolio.",
    complexity: "complex",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY_ANNOTATIONS,
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
        benchmarkSymbol: {
          type: "string",
          minLength: 1,
          description: "Benchmark symbol, e.g. NIFTY50, NIFTY500, SPX (default NIFTY50)",
        },
        days: { type: "number", minimum: 1, description: "Comparison window in days (default 90)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const benchmarkSymbol = typeof args.benchmarkSymbol === "string" ? args.benchmarkSymbol : "NIFTY50";
      const days = typeof args.days === "number" ? args.days : 90;
      return compareToBenchmark(sb, p.holdings, benchmarkSymbol, days);
    },
  },
  {
    name: "get_period_performance",
    description:
      "Performance over a financial-year period — quarter, half, or full year (FY runs Apr-Mar) — " +
      "as opposed to get_portfolio_summary's point-in-time snapshot which has no time dimension at " +
      "all. Use this whenever the question names a time window (\"this quarter\", \"Q2 performance\", " +
      "\"this half\", \"this FY\") — never answer a period-scoped question with get_portfolio_summary's " +
      "all-time totals relabeled as if they were for that period. Returns startPortfolioValue (marked " +
      "at the closest historical close on or before the period start), endPortfolioValue (today's live " +
      "price if the period is still in progress, or the closest historical close on/before period end " +
      "once it has completed), and totalChange/totalChangePercent — the change between them, which is " +
      "the actual period return to report for \"performance\". netInvestedInPeriod (buys minus sells " +
      "within the period) is informational only: buying/selling with cash already tracked in this " +
      "portfolio is a reallocation, not a value change, so never subtract it from totalChange yourself " +
      "— that would double-count the reallocation as a phantom gain or loss (this tool cannot tell " +
      "fresh external money apart from redeployed existing cash, since no such distinction is tracked). " +
      "Defaults to the quarter containing today if no arguments are given. Does not support " +
      "month-level granularity — say so if asked for a specific month.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        periodType: {
          type: "string",
          enum: ["quarter", "half", "year"],
          description: "Period granularity (default \"quarter\")",
        },
        fyStartYear: {
          type: "number",
          minimum: 2000,
          description: "FY start year, e.g. 2026 for FY2026-27 (default: the FY containing today)",
        },
        periodIndex: {
          type: "number",
          minimum: 1,
          description:
            "Which period within that FY/type: 1-4 for quarter, 1-2 for half, 1 for year " +
            "(default: the period containing today)",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      const p = await getCurrentPortfolio(sb);
      const periodType = (typeof args.periodType === "string" ? args.periodType : "quarter") as PeriodType;
      const fyStartYear = typeof args.fyStartYear === "number" ? args.fyStartYear : undefined;
      const periodIndex = typeof args.periodIndex === "number" ? args.periodIndex : undefined;
      return getPeriodPerformance(sb, p.holdings, p.cash, periodType, fyStartYear, periodIndex, new Date(), p.missingPriceSymbols);
    },
  },
  {
    name: "get_portfolio_value_at_date",
    description:
      "Total portfolio valuation as of a specific past (or present) date — holdings priced at the " +
      "closest historical_prices close on/before that date, cash/PF/credit-card-debt from the closest " +
      "net_worth_history snapshot on/before it. As opposed to get_portfolio_summary's always-current " +
      "snapshot (no date parameter at all) and get_period_performance's FY-quarter/half/year-only " +
      "granularity, this takes an arbitrary calendar date. To compare two dates or months (e.g. " +
      "\"July 2025 vs. July 2026\"), call this once per date and diff the returned portfolioValue " +
      "figures yourself — never decline a historical-valuation question by claiming no access to " +
      "past data, since historical_prices/net_worth_history make this genuinely available. For a " +
      "month name, pass that month's last day as asOfDate to get the month-end valuation.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        asOfDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Date to value the portfolio as of, format YYYY-MM-DD",
        },
      },
      required: ["asOfDate"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      // asOfDate is already validated against the pattern above by the time it reaches here — see
      // validateArgs in mcp-schema-validate.ts.
      const asOfDate = args.asOfDate as string;
      return getPortfolioValueAsOf(sb, asOfDate);
    },
  },
  {
    name: "get_exposure_drift",
    description: "Compares current geography/category exposure percentages against a past date.",
    complexity: "complex",
    inputSchema: {
      type: "object",
      properties: {
        asOfDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Past date to compare against, format YYYY-MM-DD",
        },
      },
      required: ["asOfDate"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, sb) => {
      // asOfDate is already validated against the pattern above by the time
      // it reaches here — see validateArgs in mcp-schema-validate.ts.
      const asOfDate = args.asOfDate as string;
      return getExposureDrift(sb, asOfDate);
    },
  },
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
