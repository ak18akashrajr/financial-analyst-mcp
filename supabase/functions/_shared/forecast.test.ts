// Covers this file's hand-mirrored subset of src/lib/portfolioSeries.ts + src/lib/forecast.ts (see
// forecast.ts's top-of-file doc comment for why it's a mirror, not a shared import, and why it's a
// deliberately smaller surface). The priority case is the same one as src/test/portfolio-series.test.ts:
// flow-adjustment must not read a contribution as a market return, since that's what would silently
// corrupt forecast_portfolio_value's fitted drift.
import { describe, expect, it } from "vitest";
import {
  buildValueSeries,
  fitCaveats,
  fitParameters,
  flowAdjustedReturns,
  forecastParametricTerminal,
  MAX_ABS_DRIFT,
  MIN_OBSERVATIONS,
  weightedAssumptions,
  type PricesBySymbol,
  type SeriesTransaction,
} from "./forecast.ts";

const buy = (symbol: string, date: string, quantity: number, price: number): SeriesTransaction => ({
  symbol,
  type: "BUY",
  quantity,
  price,
  date,
});
const sell = (symbol: string, date: string, quantity: number, price: number): SeriesTransaction => ({
  symbol,
  type: "SELL",
  quantity,
  price,
  date,
});
const bars = (entries: [string, number][]) => entries.map(([date, close]) => ({ date, close }));
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);

describe("buildValueSeries + flowAdjustedReturns", () => {
  it("reports a zero return on a pure contribution day with no market move", () => {
    // The case this whole module exists for: ₹1,000 held, ₹1,000 added, price unchanged. Naive
    // (V1 − V0)/V0 would read +100%; the true market return is 0%.
    const txns = [buy("A", "2026-01-01", 10, 100), buy("A", "2026-01-02", 10, 100)];
    const prices: PricesBySymbol = { A: bars([["2026-01-01", 100], ["2026-01-02", 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 2000]);
    expect(flowAdjustedReturns(series)).toEqual([0]);
  });

  it("separates the market move from the contribution on a day with both", () => {
    const txns = [buy("A", "2026-01-01", 10, 100), buy("A", "2026-01-02", 10, 110)];
    const prices: PricesBySymbol = { A: bars([["2026-01-01", 100], ["2026-01-02", 110]]) };

    expect(flowAdjustedReturns(buildValueSeries(txns, prices))).toEqual([0.1]);
  });

  it("carries the last close forward for a symbol with no bar on a grid date", () => {
    const txns = [buy("A", "2026-01-01", 1, 100), buy("B", "2026-01-01", 1, 50)];
    const prices: PricesBySymbol = {
      A: bars([["2026-01-01", 100], ["2026-01-02", 100], ["2026-01-05", 100]]),
      B: bars([["2026-01-01", 50], ["2026-01-02", 60]]),
    };

    const series = buildValueSeries(txns, prices);
    expect(series.points.map((p) => p.value)).toEqual([150, 160, 160]);
  });

  it("drops a holding from value once it is fully sold", () => {
    const txns = [buy("A", "2026-01-01", 10, 100), sell("A", "2026-01-02", 10, 110)];
    const prices: PricesBySymbol = { A: bars([["2026-01-01", 100], ["2026-01-02", 110], ["2026-01-03", 120]]) };

    expect(buildValueSeries(txns, prices).points.map((p) => p.value)).toEqual([1000, 0, 0]);
  });

  it("flags an incomplete point while a held symbol has no price yet, and excludes it from returns", () => {
    const txns = [buy("A", "2026-01-01", 1, 100), buy("B", "2026-01-01", 1, 500)];
    const prices: PricesBySymbol = {
      A: bars([["2026-01-01", 100], ["2026-01-02", 100], ["2026-01-03", 100]]),
      B: bars([["2026-01-03", 500]]),
    };

    const series = buildValueSeries(txns, prices);
    expect(series.symbolsWithoutPrices).toEqual(["B"]);
    expect(series.incompletePoints).toBe(2);
    // Only the 3rd->onward pair could survive, and there's only 3 points, so no pair does.
    expect(flowAdjustedReturns(series)).toEqual([]);
  });

  it("classifies daily vs monthly spacing and annualizes accordingly", () => {
    const daily = buildValueSeries([buy("A", "2026-01-01", 1, 100)], {
      A: bars([["2026-01-01", 100], ["2026-01-02", 100], ["2026-01-05", 100], ["2026-01-06", 100]]),
    });
    expect(daily.granularity).toBe("daily");
    expect(daily.periodsPerYear).toBe(252);

    const monthly = buildValueSeries([buy("A", "2026-01-31", 1, 100)], {
      A: bars([["2026-01-31", 100], ["2026-02-28", 100], ["2026-03-31", 100], ["2026-04-30", 100]]),
    });
    expect(monthly.granularity).toBe("monthly");
    expect(monthly.periodsPerYear).toBe(12);
  });

  it("returns an empty series with no transactions or no price data", () => {
    expect(buildValueSeries([], { A: bars([["2026-01-01", 100]]) }).points).toEqual([]);
    expect(buildValueSeries([buy("A", "2026-01-01", 1, 100)], {}).points).toEqual([]);
  });
});

describe("fitParameters", () => {
  it("annualizes drift and volatility by the given period count", () => {
    const fit = fitParameters(repeat(0.001, 252), 252);
    expect(fit.driftAnnual).toBeCloseTo(0.252, 10);
    expect(fit.observations).toBe(252);
    expect(fit.sufficient).toBe(true);
    expect(fit.usedFallback).toBe(false);
  });

  it("clamps an implausible drift symmetrically and reports what it measured", () => {
    const up = fitParameters(repeat(0.01, 252), 252); // 252%/yr
    expect(up.rawDriftAnnual).toBeCloseTo(2.52, 10);
    expect(up.driftAnnual).toBe(MAX_ABS_DRIFT);
    expect(up.driftClamped).toBe(true);

    const down = fitParameters(repeat(-0.01, 252), 252);
    expect(down.driftAnnual).toBe(-MAX_ABS_DRIFT);
  });

  it("falls back to the given assumption when the sample is too thin, and ignores it once sufficient", () => {
    const thin = fitParameters(repeat(0.05, 10), 252, { expectedReturn: 0.11, volatility: 0.16 });
    expect(thin.usedFallback).toBe(true);
    expect(thin.driftAnnual).toBeCloseTo(0.11, 10);
    expect(thin.volAnnual).toBeCloseTo(0.16, 10);

    const enough = fitParameters(repeat(0.0004, MIN_OBSERVATIONS), 252, { expectedReturn: 0.11, volatility: 0.16 });
    expect(enough.usedFallback).toBe(false);
  });

  it("is marked insufficient (not silently fabricated) with a thin sample and no fallback", () => {
    const fit = fitParameters(repeat(0.001, MIN_OBSERVATIONS - 1), 252);
    expect(fit.sufficient).toBe(false);
    expect(fit.usedFallback).toBe(false);
  });
});

describe("weightedAssumptions", () => {
  it("blends per-category assumptions by weight", () => {
    // 60% Stocks (0.12/0.18), 40% Bonds (0.07/0.04): mean-weighted, not a plain average.
    const result = weightedAssumptions([{ label: "Stocks", weight: 60 }, { label: "Bonds", weight: 40 }]);
    expect(result.expectedReturn).toBeCloseTo(0.6 * 0.12 + 0.4 * 0.07, 10);
    expect(result.volatility).toBeCloseTo(0.6 * 0.18 + 0.4 * 0.04, 10);
  });

  it("falls back to the default assumption for an unrecognized category or empty weights", () => {
    const unknown = weightedAssumptions([{ label: "Nonexistent Category", weight: 100 }]);
    expect(unknown.expectedReturn).toBeCloseTo(0.10, 10);
    expect(unknown.volatility).toBeCloseTo(0.14, 10);

    const empty = weightedAssumptions([]);
    expect(empty.expectedReturn).toBeCloseTo(0.10, 10);
  });
});

describe("forecastParametricTerminal", () => {
  it("collapses to the deterministic compounding value when volatility is zero", () => {
    const terminal = forecastParametricTerminal(100_000, 0.12, 0, 12, 50);
    const expected = 100_000 * Math.exp(0.12);
    expect(terminal.p10).toBeCloseTo(expected, 6);
    expect(terminal.p50).toBeCloseTo(expected, 6);
    expect(terminal.p90).toBeCloseTo(expected, 6);
  });

  it("orders the percentiles and never produces a negative value", () => {
    const terminal = forecastParametricTerminal(100_000, 0.12, 0.18, 24, 500);
    expect(terminal.p10).toBeLessThan(terminal.p25);
    expect(terminal.p25).toBeLessThan(terminal.p50);
    expect(terminal.p50).toBeLessThan(terminal.p75);
    expect(terminal.p75).toBeLessThan(terminal.p90);
    expect(terminal.p10).toBeGreaterThanOrEqual(0);
  });

  it("returns the starting value unchanged at a zero-month horizon", () => {
    const terminal = forecastParametricTerminal(100_000, 0.12, 0.18, 0, 50);
    expect(terminal.p10).toBe(100_000);
    expect(terminal.p50).toBe(100_000);
    expect(terminal.p90).toBe(100_000);
  });
});

describe("fitCaveats", () => {
  it("is silent for a healthy daily fit", () => {
    expect(fitCaveats(fitParameters(repeat(0.0004, 300), 252), "daily")).toEqual([]);
  });

  it("names the fallback and the observation requirement", () => {
    const fit = fitParameters(repeat(0.001, 10), 252, { expectedReturn: 0.11, volatility: 0.16 });
    const caveats = fitCaveats(fit, "daily");
    expect(caveats[0]).toContain("10 return observations");
    expect(caveats[0]).toContain(String(MIN_OBSERVATIONS));
  });

  it("flags monthly granularity and a clamped drift", () => {
    expect(fitCaveats(fitParameters(repeat(0.005, 100), 12), "monthly").some((c) => c.includes("monthly"))).toBe(true);
    expect(fitCaveats(fitParameters(repeat(0.01, 252), 252), "daily").some((c) => c.includes("clamped"))).toBe(true);
  });
});
