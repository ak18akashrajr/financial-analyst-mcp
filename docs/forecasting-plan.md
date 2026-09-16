# Time series forecasting

The Forecast page ([Forecast.tsx](../src/pages/Forecast.tsx)) and the `forecast_portfolio_value`
MCP tool project total portfolio value forward as a percentile band, using drift and volatility
**fitted from the portfolio's own historical mark-to-market series** — not a fixed assumed rate.
This doc records the design decisions behind it, since several of them aren't obvious from the code
alone.

## Why this is different from Projections/Monte Carlo

Every other forward-looking number in this app is **assumption-driven**:
[`projectXIRR`](../src/lib/projectionEngine.ts) compounds at the realized XIRR, `runMonteCarlo`
hardcodes σ = 0.18 regardless of what's actually held, and
[`weightedAssumptions`](../src/lib/assetClassAssumptions.ts) blends static per-asset-class priors
while explicitly ignoring correlations. They all answer "what if returns are X%."

This feature is **fitted**: μ and σ come from the portfolio's own observed returns, so a
concentrated crypto portfolio and a bond-heavy one get genuinely different forecasts. It answers
"what does this portfolio's own history imply." Both kinds of projection stay in the app — neither
replaces the other.

## The prerequisite: there was no input series

Nothing in this repo held a continuous portfolio value series before this feature.
`net_worth_history` is written only as a side effect of transaction/cash mutations
([usePortfolio.ts](../src/hooks/usePortfolio.ts)'s `recordNetWorthSnapshot`) — an irregular event
log, not a daily grid. `historical_prices` has mixed granularity in one table (the Reports page's
"Backfill FY" button writes daily rows, RollingReturns writes monthly rows, same `(symbol, date)`
key), and there's no cron anywhere in the repo keeping either current.

[`portfolioSeries.ts`](../src/lib/portfolioSeries.ts) builds the series on the fly: walk a grid of
every date that has a `historical_prices` row for a held symbol, carrying net BUY−SELL quantity per
symbol forward and marking each symbol to its last known close (last-observation-carried-forward —
the same rule [`fetchPriceMapAsOf`](../supabase/functions/_shared/portfolio-data.ts) uses for a
single date, applied over a grid instead). No new table, no migration.

## Three decisions the correctness of the fit depends on

1. **Returns are flow-adjusted.** A ₹1L BUY raises portfolio value without being a market return —
   the naive `(V_t − V_t−1)/V_t−1` would read every SIP day as a huge gain and bias the fitted drift
   badly upward. `flowAdjustedReturns` uses the daily modified-Dietz form instead:
   `r_t = (V_t − V_t−1 − netFlow_t) / V_t−1`. This was treated as the single highest-risk piece of
   the whole feature and tested first (`src/test/portfolio-series.test.ts`).

2. **The fit is equity-only, not net worth.** Cash/PF/credit-card-debt come from the sparse,
   event-driven `net_worth_history`; forward-filling them onto the grid would inject step changes on
   edit days straight into the fitted volatility. Only the market-driven holdings value is fitted.

   For **display**, both the Forecast page and the MCP tool add today's cash/PF/credit-card-debt
   back as a flat, non-stochastic offset applied to *every* point — past and future alike, not just
   the forecast. This is a deliberate simplification: applying the same offset everywhere keeps the
   chart's units consistent ("total portfolio value") and makes the forecast start exactly where the
   realized line ends, with no visible jump at the seam. The cost is that it doesn't reflect what
   cash actually was on past dates — `net_worth_history` is too sparse to reconstruct that reliably.
   The page's amber caveat line states this explicitly rather than leaving it implicit in the chart.

3. **Annualization respects actual row spacing.** Because `historical_prices` granularity is mixed
   per symbol, annualizing monthly observations by ×252 (the daily-trading-day convention) would
   overstate volatility by roughly 4.6×. `detectGranularity` classifies the median gap between grid
   dates as daily/monthly/mixed and picks ×252, ×12, or `365/medianGapDays` accordingly, and reports
   which was used.

## Fitting and projecting

[`forecast.ts`](../src/lib/forecast.ts) (frontend) does the fit:

- **Drift and volatility** are the mean and sample standard deviation of the flow-adjusted returns,
  annualized by the detected granularity — reusing `stdDev` from
  [`riskMetrics.ts`](../src/lib/riskMetrics.ts) rather than rewriting it. An EWMA volatility variant
  (λ = 0.94, the standard RiskMetrics decay) is also computed and offered as a toggle, weighting
  recent regime more heavily than the plain sample figure.
- **Thin samples fall back to assumptions.** Below `MIN_OBSERVATIONS` (60) returns, the fit falls
  back to `weightedAssumptions()` priors instead of trusting a noisy estimate — the same
  graceful-degradation pattern as `missingPriceSymbols` and `benchmarkDataAvailable` elsewhere in
  this app. `usedFallback`/`sufficient` flags say which happened.
- **Drift is clamped to ±50%/yr** (`MAX_ABS_DRIFT`). A short lucky window can fit a drift of
  200%+/yr; projecting that compounds into nonsense. The pre-clamp figure (`rawDriftAnnual`) is kept
  so a clamped fit can still say what it actually measured.
- **A lookback window** restricts what the fit sees to the trailing 1/2/3/5 years, or all available
  history (the default). This is independent of the forecast horizon and of the chart's own
  drag-select range — it exists so a recent regime change (e.g. a big allocation shift) can be
  tested without the fit being diluted by years of unrelated history. Restricting the lookback only
  changes the fit; the chart's realized line always shows full history regardless.

Two projection methods:

- **Parametric** — log-normal GBM, monthly steps: `v *= exp((μ − σ²/2)/12 + σ/√12 · Z)`. Deliberately
  *not* the arithmetic-normal walk used in `projectionEngine.ts`/`monteCarloAdvanced.ts` (which can
  go negative, hence their `if (v < 0) v = 0` clamps, and compounds wrongly over multi-year
  horizons) — GBM can't produce a negative value and compounds correctly.
- **Bootstrap** — resamples contiguous ~20-observation blocks of the portfolio's *actual observed*
  returns with replacement. Makes no distributional assumption, so real fat tails and volatility
  clustering carry through; this is what makes the feature a genuine forecast rather than a
  reskinned Monte Carlo. Needs at least `MIN_OBSERVATIONS` returns; falls back to parametric
  otherwise.

Both take an injectable `rng` (default `Math.random`), so tests can seed it and assert exact
numbers — the existing simulation modules can only be tested for statistical invariants because they
call `Math.random` directly.

## Backtest: why the band should be believed

`backtestForecast` does walk-forward validation: fit on history up to a cutoff, forecast the same
horizon forward from there, and compare against what actually happened — repeated across a few
cutoffs spread through the available history. Reported as **coverage** (share of folds where the
real outcome landed inside the predicted p10–p90 band — should sit near 80% for a well-calibrated
band) and **median absolute error**, rendered as a panel under the chart.

`backtestForecast` derives its own internally consistent (usable points, returns) pair per call
(`usableReturnsForBacktest`) rather than accepting a separately-computed returns array — an earlier
version took the caller's own `flowAdjustedReturns` output and filtered `points` independently,
which desynchronized the two arrays' indices whenever an incomplete stretch existed (a newly-bought
symbol before its first price arrives). `usableReturnsForBacktest` instead carries any flow that
happened during a skipped incomplete point forward into the next usable return, guaranteeing
`usable.length - 1 === returns.length` by construction. See its doc comment and
`src/test/forecast.test.ts`'s `usableReturnsForBacktest` suite for the regression coverage.

## The MCP tool: a smaller, hand-mirrored surface

`forecast_portfolio_value` ([mcp-tools.ts](../supabase/functions/_shared/mcp-tools.ts)) exposes the
same fit to the AI chat. Its math lives in a separate, Deno-side
[`_shared/forecast.ts`](../supabase/functions/_shared/forecast.ts) — hand-mirrored, not imported,
following the precedent `riskMetrics.ts` already set for the same browser/edge-function boundary
(neither side can import the other: the frontend is a Vite bundle, edge functions run on Deno with
`https://esm.sh/...` imports and `Deno.env`).

The server-side mirror is deliberately **smaller** than the frontend module, to bound the cost of
maintaining a duplicate by hand:

- **Parametric only** — no bootstrap, no EWMA volatility variant, no backtest. A chat answer needs
  one well-founded number, not a choice of models; those stay interactive-only on the Forecast page.
- **Terminal percentiles only** — the tool returns the p10/p25/p50/p75/p90 band at the requested
  horizon, not a full per-month series. An LLM summarizes a single band in its answer; it has no use
  for a monthly path to plot.
- No injectable RNG (every other simulation-backed tool in this registry draws a fresh Monte Carlo
  sample per call too).

If the frontend math in `src/lib/forecast.ts` or `src/lib/portfolioSeries.ts` changes, the mirror in
`supabase/functions/_shared/forecast.ts` needs the equivalent change by hand — there's no build-time
check that keeps them in sync, same as `riskMetrics.ts` today.

## The guardrail carve-out

`SYSTEM_PROMPT` ([portfolio-ai/index.ts](../supabase/functions/portfolio-ai/index.ts)) orders the
model to decline "requests for a price target/prediction on any security." Without a carve-out, the
model would refuse or heavily hedge every forecast question, since it reads as exactly that kind of
request. The `## Never recommend a trade` section now explicitly exempts
`forecast_portfolio_value`, mirroring the structure of the existing stress-test exemption: a
portfolio-*level* statistical projection is a factual description of a model's output, not a
recommendation, while the per-security prohibition stays fully intact (the tool takes no symbol and
can't answer "will X go up"). `system-prompt.test.ts` pins the guardrail strings this edit had to
keep intact.

## Known simplifications, not yet built

- **No correlation model.** `weightedAssumptions()`'s fallback (used for thin-sample portfolios)
  blends per-asset-class volatility with a simple weighted average, ignoring cross-asset
  correlation — the same limitation `assetClassAssumptions.ts` already flags for the rest of the
  app. The *fitted* path doesn't have this problem (it fits the portfolio's own historical
  co-movement implicitly), but the fallback does.
- **Coverage depends on whoever last clicked backfill.** Like every other feature built on
  `historical_prices`, there's no cron keeping price data current — see the Forecast page's
  "Backfill 2y daily prices" button and the empty-state prompt for a thin database.
