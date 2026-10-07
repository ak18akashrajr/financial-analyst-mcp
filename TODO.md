# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## Open: calculation audit (2026-10-01)

Whole-codebase audit of calculation logic (client `src/`, edge functions and SQL in `supabase/`).
Nothing was changed by the audit itself; these are the findings, to be fixed in small themed
branches (one PR each, with tests — per CLAUDE.md). Items already on the Dev Zone trade-offs
register ([acceptedTradeOffs.ts](src/lib/acceptedTradeOffs.ts)) are deliberately excluded.

**Status tags:** `[checked]` = code re-read and confirmed by hand · `[reproduced]` = ran the real
code and got the wrong output · `[agent-traced]` = traced by the audit but not independently
re-checked (re-verify before fixing — see the "verify before implementing" convention) ·
`[conditional]` = depends on something not visible from the repo (stated in the item).
Numeric examples are hand-computed unless marked reproduced.

### High — wrong numbers a decision could rest on

_No High items open — H1–H6 are all done (see Archive)._

### Medium — misleading or inconsistent numbers

**Labels / definitions**
- [ ] **M1. "Realized & Unrealized Alpha" shows unrealized P&L only.**
      [`SummaryBar.tsx:93-98`](src/components/SummaryBar.tsx) ← `usePortfolio.ts:557`. Buy 10@100,
      sell 10@150 → card shows ₹0 / 0.00%, not ₹500. Also the AUM sub-label "Holdings + Cash −
      Debt" omits PF, which `totalPortfolioValue` adds. Needs an owner decision (Question 2).
      `[checked]`
- [ ] **M3. Tax: no loss set-off, and "Total Gains" / "Post-Tax Profit" ignore losses.**
      [`taxCalculator.ts:205-206`](src/lib/taxCalculator.ts) (`Math.max(0, gain)` per lot),
      [`Taxes.tsx:207-209`](src/pages/Taxes.tsx). LT gain ₹3,00,000 + ST loss ₹1,00,000 → tax
      ₹21,875 vs ₹9,375 with set-off; repo's own test numbers show "Total Gains" +500 when true net
      is −250. Note `tax-calculator.test.ts` asserts the missing-price → full-loss behaviour.
      Decide scope first (Question 4). `[checked]`

**Returns / benchmarks / charts**
- [ ] **M5. "Portfolio Return" on Benchmark / `compare_to_benchmark` includes new contributions;
      window is N snapshots, not N days.** [`Benchmark.tsx:162-171`](src/pages/Benchmark.tsx),
      [`portfolio-data.ts:647-671`](supabase/functions/_shared/portfolio-data.ts). Holdings ₹1L +
      another ₹1L bought, prices flat → +100% (outperformance +98% vs NIFTY +2%). S&P benchmark is
      in USD points vs an INR portfolio, no FX (also `benchmarkXirr.ts:79,94`, `[agent-traced]`).
      `[checked]`
- [ ] **M7 (remaining). PortfolioCharts valuation model.** The "invested" line is fixed (see
      Archive). Still open, all `[checked]`: every past date is valued at *today's* price (so the
      "Current Value" line is hypothetical, not a record — fixing it needs `historical_prices` per date);
      a symbol with no current price falls back to its last trade price while the holdings table shows ₹0;
      `t.date.split('T')[0]` keys a point on the UTC date; a full exit drops the position from both lines,
      so the realised gain never appears in the P&L-over-time chart (by design — it's unrealised-only);
      and the drag-select XIRR badge runs on these hypothetical values. Decide whether any of these should
      change before touching them. Code: [`portfolioTimeline.ts`](src/lib/portfolioTimeline.ts).
**Goals / projections**
- [ ] **M11. "Step-up SIP equivalent" matches total rupees contributed, not future value.**
      [`monteCarloAdvanced.ts:102-106`](src/lib/monteCarloAdvanced.ts). Flat ₹10,000/mo × 10y @10%
      → ₹20.48L; suggested ₹6,275 step-up reaches ₹18.95L (7.5% short). Also `years < 1` returns
      `flat × years`. Code `[checked]`; figures `[agent-traced]`.
- [ ] **M12. Two monthly-rate conventions.** Exact `(1+r)^(1/12)−1` in `projectXIRR` /
      `simulateCrash` / `replayCrisis`; nominal `r/12` in
      [`projectionEngine.ts:128`](src/lib/projectionEngine.ts),
      [`monteCarloAdvanced.ts:35,145`](src/lib/monteCarloAdvanced.ts). 12% stated → 12.68%
      effective on the `r/12` tabs; 10y ×3.30 vs ×3.106. Pick one and document. `[checked]`
- [ ] **M13. FIRE age is a median over only the paths that reach FI, capped at retirement age.**
      [`monteCarloAdvanced.ts:160-169,210-213`](src/lib/monteCarloAdvanced.ts). At a 60.6% reach
      rate the page shows 45; counting non-reachers gives 48. Already-FI at m=0 is never detected.
      UI copy ("earliest age the median path can sustain") doesn't match. `[agent-traced]`
- [ ] **M14. Forecast backtest and bootstrap.** (a) [`forecast.ts:456-458`](src/lib/forecast.ts):
      backtest compares a no-contribution forecast with an actual value that includes new buys →
      coverage biased for anyone still investing. (b) [`Forecast.tsx:241-246`](src/pages/Forecast.tsx):
      bootstrap ignores the ±50% drift clamp while the page shows the clamped "Fitted Drift". (c)
      Backtest always uses plain-vol parametric even when Bootstrap/EWMA is selected. `[checked]`
- [ ] **M15. "Portfolio volatility" is a weighted average of per-holding volatilities (no
      diversification).** [`riskMetrics.ts:129,160`](src/lib/riskMetrics.ts),
      [`portfolio-data.ts:488`](supabase/functions/_shared/portfolio-data.ts). Two uncorrelated 20%
      assets at 50/50 → shows 20% vs true 14.1%; Sharpe understated. Either compute from the
      portfolio return series or relabel as an upper bound. `[checked]`

**Data integrity**
- [ ] **M16 (remaining). Changing a trade's date still resets its time of day.** The price/quantity-only
      path is fixed (see Archive). When the user *does* change the date, the bare `YYYY-MM-DD` still
      becomes 00:00 UTC, so a trade moved onto a day that already has trades can sort ahead of an
      earlier same-day one. Fix would keep the original time-of-day (or add a time field); not done —
      needs a decision on the UX. `[checked]`
- [ ] **M17. No oversell guard; FIFO vs net-quantity disagree once the ledger is impossible.**
      [`AddTransactionForm.tsx:57-69`](src/components/AddTransactionForm.tsx), edit path, and
      `add_transaction_and_snapshot` only check `quantity > 0`. Buy 10, sell 15, buy 10 → holdings
      10 shares, snapshot 5. `[agent-traced]`
- [ ] **M18. "All Family" view pools SELLs across members and consumes the oldest lot regardless of
      who sold.** [`lotAttribution.ts:14-34`](src/lib/lotAttribution.ts) → family split, GoalTrack
      contributions. A buys 10 (Jan), B buys 10 (Mar), B sells 10 → split shows A ₹0 / B ₹1,200
      (should be reversed). A test asserts the pooling — confirm intent first (Question 3).
      `[checked]`
- [ ] **M19. Edge functions ignore `family_member_id`.**
      [`portfolio-data.ts:164,268,810`](supabase/functions/_shared/portfolio-data.ts): `fetchCash`
      reads one arbitrary row (`limit(1).single()`), `fetchCashAsOf` reads any member's snapshot.
      `[agent-traced]` — dormant if only one member exists (Question 3).

**AI tools vs app**
- [ ] **M20. `get_period_performance` drops a holding with no price at one end only, then reports
      the difference as the return** (app falls back to cost).
      [`portfolio-data.ts:883-929`](supabase/functions/_shared/portfolio-data.ts) vs
      [`periodReports.ts:143-159`](src/lib/periodReports.ts). Agent example: +40.0% vs +7.7%.
      `[agent-traced]`
- [ ] **M21. AI exposure / limit tools exclude cash and PF; the app includes them.**
      [`portfolio-data.ts:299-310`](supabase/functions/_shared/portfolio-data.ts) vs
      `usePortfolio.ts:603-626`. India 75% (AI) vs 80% (UI). Intent is a question (Question 5).
      `[agent-traced]`
- [ ] **M23. Monthly bars can overwrite daily rows.**
      [`fetch-historical-prices/index.ts:28,51,62`](supabase/functions/fetch-historical-prices/index.ts):
      upsert key `(symbol, date)`; a monthly bar is dated the 1st but carries the month-end close →
      spurious daily returns inflate volatility. `RiskMetrics` has no granularity guard
      (`detectGranularity` exists in `portfolioSeries.ts`). `[conditional]` — depends on Yahoo's
      monthly-bar date convention, which was not verified.

### Low

- [ ] **XIRR / dates:** same-day net-zero flows return the seed 10% (`xirr.ts:46`); tax holding
      period uses elapsed 24h blocks, so a lot can read short-term up to a day late
      (`taxCalculator.ts:148`); `hasSameDayReentry` groups by UTC date (`taxCalculator.ts:274`);
      float residue (~2.8e-17) creates phantom lots in the Tax report (`taxCalculator.ts:198`);
      `forecast.ts:53-59` `toDayString` slices the UTC date.
- [ ] **Unpriced / zero prices:** client values a symbol with no price at ₹0 (stays in invested,
      shows −100%), server excludes it; a stored price of 0 is accepted by `fetch-prices` and
      treated as valid by `hasPriceData`; `fetch-historical-prices` / `fetch-benchmark-prices` only
      skip null. `fetch-fx-rates` already guards `<= 0` — copy that.
- [ ] **Display:** Family split % can exceed 100% with a negative-net-worth member
      (`FamilyNetWorthSplit.tsx:25,44`); one thinly-priced symbol blanks the whole Correlation
      heatmap (`CorrelationHeatmap.tsx:90-101`); Debt/Net-worth charts don't refresh in-session
      (`Index.tsx:62,154`); treemap keeps 8 tiles with no "Other"; untagged holdings show as
      "Equity / India" in the table but "Untagged" in exposure (→ 0% equity weight in the stress
      default, `HoldingsTable.tsx:101`, `Projections.tsx:207-213`).
- [ ] **Reports:** SIP adherence / in-progress projection miscount months (`periodReports.ts:393`;
      e.g. 200% shown instead of 100%); early-history flows divided by a tiny base
      (`portfolioSeries.ts:276`); `period-reports.test.ts:156-178` still describes the pre-fix
      boundary; `RollingReturns.tsx:297` says "Time-weighted XIRR" but XIRR is money-weighted.
- [ ] **Projections:** "Conservative" = `xirr × 0.8` is better than base when XIRR is negative
      (`periodReports.ts:426`, `projectionEngine.ts:27`); Overview Monte Carlo hardcodes 18% vol
      (`projectionEngine.ts:127`); recovery-years hint says "(plus SIPs)" but the code ignores SIP;
      fractional horizon makes `Array(years)` throw; `purchasingPowerLoss` shows "−NaN%" when the
      corpus is depleted; GoalTrack splits LT/ST gain by cost share rather than per-lot
      (`GoalTrack.tsx:170-179`); required-SIP bisection uses fresh random draws per step.
- [ ] **Deployment signal:** zero/negative PE (and negative forward PE) scores as the cheapest
      possible reading (`deploymentSignal.ts:58-59,85-86`, `DeploymentPlan.tsx:48`); CAPE applies
      the CPI array oldest-first (`fetch-ticker-cape/index.ts:17-27`, `[agent-traced]` on the
      ordering).
- [ ] **AI tools:** `get_exposure_drift` omits fully-sold categories; `run_stress_test` with
      unmatched symbols silently shocks nothing; as-of prices have no staleness limit and the
      output hides the price date.
- [ ] **Stale comments/docs:** `dateUtils.ts` and `taxCalculator.ts` say `transactions.date` is a
      Postgres `DATE`; the migration defines `TIMESTAMP WITH TIME ZONE`. Tests use bare dates, so
      they don't exercise the production shape.

### Questions that block (or shape) the fixes above

1. ~~**Row counts (H6)**~~ — answered 2026-10-06: `transactions` 118, `historical_prices` **3,425**,
   `net_worth_history` 136. Only `historical_prices` is over 1,000, so the pagination mattered for price
   history (Forecast, Correlation, Rolling, Risk Metrics and the AI risk/as-of/forecast tools) but never for
   trades or holdings. The project's max-rows setting was not found in the dashboard; unknown whether it was
   still 1,000 (the fix is correct either way).
2. **M1:** should "Realized & Unrealized Alpha" include realized gains (needs realized P&L from
   sells), or should the label say "Unrealized"?
3. **Family members (M18, M19):** does a second `family_members` row exist? Is pooled FIFO in "All
   Family" intended?
4. **Tax scope (M3, and what's left of H5):** the per-category rules are decided and shipped (batch 4:
   Gold/Silver ETFs and listed bonds 12 months; US stocks / real estate / custom 24 months; crypto flat 30%;
   FDs/PF/NPS excluded). Still open: **debt mutual funds** and **unlisted bonds** (not modelled — a category
   can't tell listed from unlisted; ask the CA), **grandfathering**, whether physical gold / gold
   funds-of-funds are held (they need 24 months), and for M3: should "if I sell everything" ignore loss lots,
   and is "more than 12 months" calendar-month or > 365 days?
5. **Cash on trades:** `add_transaction_and_snapshot` never changes cash — do you always lower
   Operating Cash by hand after a buy? Affects NetWorthChart range XIRR, `get_period_performance`
   (tells the AI a buy is "a reallocation"), and the income/expense ratio (a manual cash cut books
   as an expense unless "exclude" is ticked). Also: should AI exposure/limit tools include cash and
   PF (M21)?
6. **Non-INR symbols:** any `.L` (pence) or USD tickers? `fetch-prices` stores Yahoo's price with no
   currency check.
7. **Seasonality "returns":** month-over-month net-worth change includes deposits — intended as a
   return? (With a negative opening net worth a −100 → +50 move prints −150%.)
8. **Deployment signal:** are the PE bands (<12, 12–15, …) meant for index-level PE but applied to
   single stocks? Should the ERP penalty stack with the sector-PE penalty? Should missing factors
   deflate the score or be rescaled? Also: is the 0.7× drawdown volatility in FIRE intentional?

### Suggested order

1. ~~H1, H4, H5, and the H6 pagination~~ — done (batch 1, [PR #192](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/192); H5's remaining categories in batch 4, [PR #195](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/195)).
2. ~~H2, H3~~ — done (batch 2, [PR #193](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/193)).
3. ~~M2, M4, M7, M10~~ — done (batch 3, [PR #194](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/194); M7's valuation-model follow-ups remain). **M1 is
   still open, waiting on Question 2.**
3b. ~~M6, M16, M22~~ — done (batch 5, PR pending; M16's date-change follow-up remains).
4. The rest, after the questions above are answered. Edge-function fixes need
   `npx supabase@1.190.0 functions deploy --use-api` to take effect.

**Verified correct in the same audit (no action):** net-worth formula consistency across client,
SQL snapshot and family split; XIRR NPV/derivative/signs; client FIFO and tax lots; 12.5% LTCG /
20% STCG / ₹1.25L exemption / 4% cess; sample stdev, √252 annualisation and beta formula (client
and server match line-for-line); FX direction; Reports period construction and bridge sums;
exposure percentages summing to 100%; Monte Carlo σ/√12, Box–Muller, percentile indexing, GBM
`μ − σ²/2` drift, inflation and FIRE corpus formulas; deployment-signal weights (sum to 1.00); SQL
cash-flow classification; lakh/crore formatters. The 2026-10-01 period-boundary fix (`de1614d`)
was re-verified as correct on both the client and the edge functions — only the UTC "today" (M22)
remains.

<details>
<summary>Archive (completed)</summary>

- [x] **Calculation audit, batch 5 — M6, M16 (partial), M22** (2026-10-07). Branch `fix/audit-batch-5`, PR
      pending (number to be filled in on opening). M22 changes an edge function, which the
      `deploy-edge-functions.yml` workflow deploys automatically on merge; M6 and M16 are frontend only.
      Not started, deliberately: **M1** (still waiting on a go-ahead for the realized+unrealized design).
      - **M22 — edge functions used the UTC date for "today".** New `istDayString(now)` in
        [`portfolio-data.ts`](supabase/functions/_shared/portfolio-data.ts), used by `listTransactions`
        and `getPeriodPerformance`. At 01:30 IST on 1 Nov the UTC date still says 31 Oct, so
        `list_transactions` with no dates returned October and `get_period_performance` resolved (and marked
        "completed") the previous quarter. A sweep of the other `toISOString().slice(0, 10)` uses in the edge
        functions found only deliberate ones (market bar dates, the UTC quota day, bare-date arithmetic).
        Four of the new tests fail when the helper returns the UTC date.
      - **M16 (partial) — editing a trade reset its time of day.** `saveEdit` in
        [`TransactionHistory.tsx`](src/components/TransactionHistory.tsx) now sends `date` only when the
        user changed it; a bare date reads as 00:00 UTC, so a price-only edit of a 15:00 SELL used to move it
        ahead of its 10:00 BUY. The SQL side was read and confirmed: `COALESCE(p_date, date)` keeps the
        stored timestamp when `date` is omitted, so no migration. **Not done:** changing the date still
        resets the time of day — open item above.
      - **M6 — Rolling Returns.** (a) `computeWindowXIRR` ([`RollingReturns.tsx`](src/pages/RollingReturns.tsx))
        now returns null when units were held at window start but no start price exists, matching
        `computePortfolioWindowXIRR`, instead of treating them as free. (b) The summary table's 1Y/3Y/5Y
        columns, including the "Overall Portfolio" row, now go through new `gatedWindowXIRR` /
        `gatedPortfolioWindowXIRR` (null unless a full trailing window exists — the gate the chart already
        used), so a ~4-month position no longer prints the same figure under all three. The ungated
        functions keep their documented contract of returning a value for a partial window. The page test
        reproduced the audit's symptom against the old code (32.81% under 1Y, 3Y and 5Y).

- [x] **Calculation audit, batch 4 — H5 (remaining categories), M8, M9** (2026-10-06). Branch
      `fix/audit-batch-4`, merged via
      [PR #195](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/195). All frontend only. **M1 was not
      started:** the owner confirmed sold units are realized gain, but the "include realized in the card"
      design (and its % denominator) still needs a go-ahead.
      - **H5 — per-category tax rules.** Decided from the owner's tax table, cross-checked against public
        sources. [`taxCalculator.ts`](src/lib/taxCalculator.ts): Gold / Gold & Silver / Bonds are now 12
        months at 12.5% (assumed listed ETFs / listed bonds; slab-rate 30% estimate short-term);
        **crypto is a flat 30% with no long-term class** (a 3-year-old lot with a ₹2L gain was taxed ₹25,000
        at 12.5%, now ₹60,000); FDs / Fixed Deposits / PPF-EPF / NPS have no capital-gains treatment and are
        left out of the estimate and listed in a visible note (new `excluded` on `TaxReport`) instead of
        showing a made-up bill. US stocks / ETFs, Real Estate, Commodity and Custom Assets are unchanged
        (24 months). The Taxes page rate cards and disclaimer now match and call out the assumptions (physical
        gold / gold funds-of-funds need 24 months; unlisted bonds and debt funds differ — confirm with a CA).
        Not modelled: debt mutual funds, unlisted bonds, grandfathering, crypto's 1% TDS. Tests: ten new
        calculator cases fail against the old code, plus a page-level test for the note and rate cards.
        Not looked at in a running browser (the app is behind a login).
      - **M8 — drag-select range followed the cursor after mouse-up.** `onMouseMove` in
        [`useChartRangeSelection.ts`](src/hooks/useChartRangeSelection.ts) now only extends the range while a
        drag is held (tracked in a ref so a move can't race the mouse-down's state update). Fixes the badge on
        Reports, NetWorth, Debt, Rolling and Portfolio charts. The two tests that exercise the bug fail
        against the old hook.
      - **M9 — Reports KPI showed a green "+0.00% vs …" off a zero base.** New `percentChangeOver` in
        [`periodReports.ts`](src/lib/periodReports.ts) returns null for a non-positive base; `pct` is
        nullable through the page and `buildGrowthComparison`, rendered as a neutral "—" (and a plain
        sentence in the AI-narrative prompt and the audit table). Page test fails against the old page.

- [x] **Calculation audit, batch 3 — M2, M4, M7 (partial), M10** (2026-10-06). Branch
      `fix/audit-medium-batch-3`, merged via
      [PR #194](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/194). All frontend only —
      nothing here needs an edge-function deploy. **M1 was deliberately not started:** it needs an owner
      decision first (Question 2 — should "Realized & Unrealized Alpha" include realized gains, or be
      relabelled "Unrealized").
      - **M2 — "Top Gainers" included losing holdings.** `topMovers` in
        [`usePortfolio.ts`](src/hooks/usePortfolio.ts) now filters each list to its own side of zero
        before taking three (a flat holding is neither), so a holding can't be in both. There were no
        tests for it; the new file uses the audit's +10% / −3% / −12% example, and four of its five cases
        fail against the old code.
      - **M4 — dollar-adjusted returns mixed FIFO cost (INR) with average cost (USD).**
        `holdingsInUsd` ([`fx.ts`](src/lib/fx.ts)) now tracks FIFO lots in USD too, each at its own
        trade-date rate, so both currencies describe the same shares. The audit's example (buy 10@100 +
        10@200, sell 10, FX flat at 80) now shows 0% currency effect and an 80 entry rate instead of
        +33% and ~106.67. Tests include a cross-check against `computeFifoPosition` on a messy sequence.
      - **M7 (partial) — PortfolioCharts reduced "invested" by sale proceeds.** The series moved into a
        pure [`buildPortfolioTimeline`](src/lib/portfolioTimeline.ts) with FIFO lots (buy 10@100, sell
        9@500 now gives invested ₹100, not −₹3,500). **Not done** — the valuation-model points are an
        open item above; they are design choices, not arithmetic errors. Confirmed by swapping the old
        algorithm back in: four of the new tests fail against it.
      - **M10 — Projections "currently allocated" differed from GoalTrack.** `Allocation`,
        `resolveSymbolRequestQty` and `buildScaleMap` moved to
        [`goalAllocations.ts`](src/lib/goalAllocations.ts) (re-exported from `GoalTrack`, so existing
        imports are unchanged) and a shared `computeGoalMarketValues` is now used by Projections. The
        audit's example (track_max row, stored qty 10, 20 held @ ₹1,500) shows ₹30,000 on both pages
        instead of ₹15,000 vs ₹30,000; the goal Monte Carlo's start corpus follows. A test cross-checks it
        against GoalTrack's own `computeAllocTax` totals, and a page-level test drives the real Goals tab.

- [x] **Calculation audit, batch 2 — H2, H3, plus a missed H6 sweep** (2026-10-06). Branch
      `fix/audit-high-batch-2`, merged via
      [PR #193](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/193). H2, H3 and the H6
      follow-up all change edge functions or shared code, so the edge-function side needs
      `npx supabase@1.190.0 functions deploy --use-api` to take effect.
      - **H2 — forecast compounded cash, PF and credit-card debt at the equity drift/volatility.**
        `forecastParametric` / `forecastBootstrap` ([`forecast.ts`](src/lib/forecast.ts)) gained a
        `flatOffset` option: the simulation now compounds the equity-only value and the offset is
        added to every path afterwards. The [Forecast page](src/pages/Forecast.tsx) and the
        `forecast_portfolio_value` tool (via `forecastParametricTerminal`'s hand-mirrored copy in
        [`_shared/forecast.ts`](supabase/functions/_shared/forecast.ts)) pass equity as the start
        value plus the offset. The backtest was already equity-only and is unchanged. Audit example
        (equity ₹50L + cash/PF ₹30L, 12% / 18% vol, 24 months): p50 was ₹98.5L, intended ₹91.5L.
        Tests: function-level invariants (every percentile shifts by exactly the offset, spread
        untouched, zero-vol closed form, negative offset, bootstrap incl. the no-observations fan),
        plus page- and tool-level wiring tests; seven function-level and both wiring tests confirmed
        to fail against the old behaviour.
      - **H3 — portfolio risk metrics did not re-weight after dropping holdings with no price
        history.** [`riskMetrics.ts`](src/lib/riskMetrics.ts) and the identical code in
        [`portfolio-data.ts`](supabase/functions/_shared/portfolio-data.ts) now divide each weighted
        sum by the included weight. Audit example: A 60% (20% return, beta 1.0) + B 40% with no data
        read as 12% / 0.60 / alpha +3.2%; now 20% / 1.0 / +10.0%. The page footer and the
        `get_risk_metrics` description now say the rest is re-weighted. **The existing exclusion test
        could not have caught this** (both holdings had zero volatility); the new tests use the
        audit's numbers and four of them fail against the old weighting.
      - **H6 follow-up — three reads the original sweep missed.** I trusted the audit's list of call
        sites instead of sweeping every `.from(...)` read, and batch 1 shipped without these:
        [`Forecast.tsx`](src/pages/Forecast.tsx) (`historical_prices`, ascending — kept the oldest
        1,000 rows, so the start value was stale), [`XirrDetailsCard.tsx`](src/components/XirrDetailsCard.tsx)
        (`benchmark_history`, whole daily history — past ~4 years the replay's terminal price was
        years stale) and [`DollarReturnsCard.tsx`](src/components/DollarReturnsCard.tsx)
        (`.limit(3000)` with a "most recent 3000" comment that the 1,000-row cap silently overrode).
        All now use `fetchAllPages`; each has a regression test whose fake enforces the cap and
        fails with paging disabled. A full sweep of every client `.from(...)` read afterwards found
        nothing else unbounded: the remaining reads are `.limit(n)` windows, filtered to one request /
        the unacknowledged incidents only (DevZone, `SecurityIncidentsContext`), single-row lookups,
        or small config tables.

- [x] **Calculation audit, batch 1 — H1, H4, H5 (partial), H6** (2026-10-06). One branch, one commit
      per item: `fix/audit-high-batch-1`, merged via
      [PR #192](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/192). H1 and H6
      change edge functions, so they need `npx supabase@1.190.0 functions deploy --use-api` to take
      effect; H4 and H5 are frontend only.
      - **H1 — AI tools used the old "subtract sale proceeds" cost basis.**
        `computeHoldingsFromTxns` ([`portfolio-data.ts`](supabase/functions/_shared/portfolio-data.ts))
        now uses a hand-mirrored FIFO port of [`costBasis.ts`](src/lib/costBasis.ts) (same pattern as
        `forecast.ts`). Buy 10@100, sell 5@300 now gives invested ₹500 / +200% instead of −₹500 /
        −400%. Tests: four new cases in `portfolio-data.test.ts` (partial sell, multi-lot FIFO,
        out-of-order rows, as-of reconstruction), all confirmed to fail against the old formula.
      - **H4 — XIRR returned `null` for annualised losses worse than ~−42%.**
        [`xirr.ts`](src/lib/xirr.ts) now retries Newton from several starts (the 10% seed stays
        first, so every case that already converged is unchanged) and falls back to bracketed
        bisection. Shared solver, so dashboard / USD / benchmark / rolling XIRR all benefit. Tests:
        seven new cases in `xirr.test.ts` (−45%, −50%, −90%, 30-day, 90-day, multi-flow); six
        confirmed to fail before the fix.
      - **H5 (partial) — category `'Stocks'` got the wrong tax rules.** Added to the holding-period
        and STCG-rate switches in [`taxCalculator.ts`](src/lib/taxCalculator.ts) (12 months, 20% STCG,
        12.5% LTCG with the exemption). **Not done:** the other categories that fall to the default —
        still open above, pending Question 4. Test: one new case in `tax-calculator.test.ts`,
        confirmed to fail before.
      - **H6 — unpaginated reads hit PostgREST's silent 1,000-row cap.** New
        [`fetchAllPages`](src/lib/fetchAllPages.ts) and its Deno copy
        [`paginate.ts`](supabase/functions/_shared/paginate.ts): range-based, all-or-nothing on error
        (a half-read list is never returned), page-capped so a query that ignores `.range()` can't
        loop. Callers add an `id` tie-break to their ordering so rows tying on `date` can't be
        skipped or duplicated. Applied to `usePortfolio` (transactions), `RiskMetrics`,
        `CorrelationHeatmap`, `RollingReturns`, `useNetWorthHistory`, `Reports` (client) and
        `fetchTxns`, `fetchDailyReturnsBySymbol`, `fetchPriceMapAsOf`, `getExposureDrift`, the
        `forecast_portfolio_value` price read (edge). `useDollarReturns` already paged correctly.
        The bounded `.limit(days + 1)` reads were left alone. Tests: `fetch-all-pages.test.ts`,
        `use-portfolio-pagination.test.tsx`, `portfolio-data-pagination.test.ts` — their fakes enforce
        the 1,000-row cap and fail with paging disabled. Fourteen existing hand-built Supabase mocks (11 frontend, 3 edge-function)
        gained `.range()` / second-`.order()` support.
        **Caveat:** the live row counts were never checked (Question 1), so whether the cap was
        already biting is unknown — the fix is correct either way.

- [x] **Time series forecasting.** Genuine fitted forecasting, distinct from the existing
      assumption-driven Projections/Monte Carlo — drift and volatility are fitted from the
      portfolio's own historical mark-to-market return series, not a fixed assumed rate. Branch
      `feat/time-series-forecasting`, merged via
      [PR #154](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/154),
      [#155](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/155),
      [#156](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/156).
      [`src/lib/portfolioSeries.ts`](src/lib/portfolioSeries.ts) builds a daily equity value series
      from transactions × `historical_prices` (no new table), with flow-adjusted (modified-Dietz)
      returns so a SIP contribution isn't misread as a market gain.
      [`src/lib/forecast.ts`](src/lib/forecast.ts) fits drift/vol (EWMA variant + thin-sample
      fallback to asset-class assumptions + drift clamping), projects forward via log-normal GBM or
      block-bootstrap, and walk-forward backtests the fitted band's own calibration. New
      [`/forecast`](src/pages/Forecast.tsx) page with horizon/method/lookback/EWMA controls, a
      realized+forecast chart, caveat banners, and a backtest coverage panel. New
      `forecast_portfolio_value` MCP tool
      ([`_shared/mcp-tools.ts`](supabase/functions/_shared/mcp-tools.ts)), backed by a
      hand-mirrored Deno-side [`_shared/forecast.ts`](supabase/functions/_shared/forecast.ts),
      wired into the router's complexity keywords and the system prompt's guardrail carve-out
      (portfolio-level forecasts are exempt from the no-price-prediction rule). Design rationale:
      [docs/forecasting-plan.md](docs/forecasting-plan.md). Two live-reported follow-up fixes on
      the same branch: a chart tooltip showing "p10-p90 band: NaN" (the range `Area`'s `[p10, p90]`
      tuple was formatted as a plain number — extracted into a unit-tested
      `formatChartTooltipValue`), and a missing staleness warning when the forecast's anchor date
      (the last date with a real `historical_prices` row) was months behind real "today" because
      prices hadn't been backfilled (added a caveat banner naming the stale date and gap). Also
      fixed a pre-existing, unrelated bug found while wiring the UI: `Projections.tsx` nested an
      `InfoHint`'s own `<button>` inside a Radix `TabsTrigger` (already a `<button role="tab">`) —
      invalid HTML and broken tab keyboard/screen-reader semantics — each hint now sits as a
      sibling after its trigger instead. Tests: extensive new coverage across
      `src/test/forecast*.test.ts`, `portfolio-series.test.ts`, `projections-tabs-nesting.test.tsx`,
      plus `mcp-tools.test.ts`/`forecast.test.ts` on the edge-function side.

**Performance review action items (all resolved 2026-09-12)** — priority recommendations from a
performance review of the repo (2026-09-11).

- [x] **High: Memoize XIRR calculations or pre-compute in Postgres.** Done on branch `perf/split-xirr-memo`,
      merged via [PR #150](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/150), together with the Medium item below (they turned out to be the same
      change). **Two corrections to this item's diagnosis, both checked against the code:**
      1. It ran **once** per recompute, not twice. `xirrExPf` is assigned `= xirr` and only
         recomputed inside `if (hasPfHoldings)` — true only when a transaction's symbol is tagged
         `PPF / EPF` in `symbol_metadata`, which nothing is today (the code comment there already
         said so).
      2. **"Cache as a pre-computed column updated only on transaction mutations" would have been
         wrong.** The terminal cash flow is the current portfolio value at `new Date()`, which moves
         with `current_prices` — a column refreshed only on transaction writes goes stale on the
         next price fetch. Not implemented, deliberately.
      The real waste was the dependency array, not the call count: the XIRR was computed inline in
      `summary`, whose deps include `cash`, so every balance edit / bill settlement / PF update
      re-ran Newton-Raphson over the whole transaction history even though no cash figure appears
      anywhere in its cash flows. Now three memos instead of one — `holdingsTotals` (one pass for
      invested/current, was two `.reduce()`s), `xirrFigures` (deps: transactions, symbolMetadata,
      holdings — **no** `cash`), and `summary` (arithmetic on the above, still re-runs on `cash`).
      Side effect worth naming: the terminal flow's `new Date()` is sampled less often, which is the
      more honest behavior — an XIRR shouldn't shift because someone corrected a bank balance.
      Not done: a transaction-set-hash memo cache across mounts. A hash of the transactions alone is
      an unsound key for the reason in correction 2 above, and `useMemo` already covers the
      within-mount case.
      Tests: [use-portfolio-xirr-memoization.test.tsx](src/test/use-portfolio-xirr-memoization.test.tsx)
      — spies on the real `calculateXIRR` and asserts a cash edit doesn't re-enter it while a price
      change does. Confirmed to fail against the pre-split code (3 calls where 2 are expected).

- [x] **High: Paginate transaction fetches on frontend** — **resolved as display-only paging; the
      *fetch* is deliberately still unpaginated.** Branch `perf/transaction-history-paging`,
      merged via [PR #152](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/152). The
      "no `.limit()`" observation is accurate, but the proposed fix would have traded a load-time
      cost for wrong numbers, so it was scoped down on purpose (user's call, 2026-09-12).
      Why the fetch can't be paginated as written: `transactions` is the sole input to FIFO cost
      basis ([costBasis.ts](src/lib/costBasis.ts)), XIRR, `holdings`, and tax lots
      ([taxCalculator.ts](src/lib/taxCalculator.ts)). An "initial page + load-more" doesn't render a
      shorter list — it renders a **wrong portfolio**, because a partial history mis-computes every
      derived figure. Doing this properly means moving those aggregations into Postgres, which is a
      separate, much larger piece of work, not a `.limit()` call. Not attempted here.
      Second finding, which changes what "paginate the table" can even mean: **there is no
      all-transactions table in the UI.** Checked every consumer — `holdings`/`exposure`/`summary`
      aggregate rather than list; [RecentActivity.tsx](src/components/RecentActivity.tsx) filters to
      the current calendar month, so it's bounded by construction; `SIPSummary`, `SummaryBar`,
      `PortfolioCharts`, `CorrelationHeatmap` all aggregate. The only unbounded rendered transaction
      list is [TransactionHistory.tsx](src/components/TransactionHistory.tsx) — one symbol's full
      history inside an expanded `HoldingsTable` row — so that's where the paging went: first 20
      rows (`TRANSACTION_PAGE_SIZE`), a "Show N more" that appends a page, a "Collapse" back to the
      first, and a "showing X of Y" count so nothing looks silently truncated.
      Also checked: [Taxes.tsx](src/pages/Taxes.tsx) runs its *own* `transactions`/`current_prices`/
      `symbol_metadata` fetch, but it doesn't call `usePortfolio`, so this is a standalone page load
      rather than the double-fetch-on-one-mount shape of
      [perf-findings.md](docs/perf-findings.md)'s finding #2. It needs the whole set for FIFO tax
      lots. No change.
      **Not done — price/metadata caching with an expiry check.** `current_prices` and
      `symbol_metadata` are one row per tracked symbol (tens of rows), so an expiry-checked cache
      buys very little, and serving a stale *price* from cache on a money dashboard is a worse
      failure than re-reading a small table. Sessions also live in `sessionStorage` by design (see
      the single-user note in [CLAUDE.md](CLAUDE.md)), so a cache would either not survive a tab
      close or would outlive the session it belongs to.
      **Honest caveat:** the per-page-load transfer/parse cost this item opens with is therefore
      *unchanged*. Nobody measured the real row count before the item was written, and nothing here
      measures it either — if that cost is ever actually felt, the next step is a row count first,
      then server-side aggregation, not client pagination.
      Tests: [transaction-history-paging.test.tsx](src/test/transaction-history-paging.test.tsx) —
      7 cases (single-page list gets no controls at all, cap + withheld count, newest-first
      ordering preserved, per-click append, partial last page, collapse, row actions intact,
      empty list). 6 of the 7 confirmed to fail against the pre-paging component.

- [x] **Medium: Break apart `usePortfolio`'s memoized derivations to avoid cascading
      recalculations.** Done on the same branch/PR as the High item above
      ([PR #150](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/150)) — these were the same change,
      approached from two directions. **One correction:** a *price* change genuinely invalidates
      `summary`, `topMovers` and `exposure`, so no amount of splitting avoids recomputing them then;
      that cascade is correct behavior, not waste. What was avoidable was the *`cash`* cascade, since
      `holdings` doesn't depend on `cash` at all. Both `summary` and `exposure` listed `cash` in
      their deps and did full holdings passes inside.
      Implemented exactly the intermediate-memo shape this item suggested: `exposureGroups` groups
      holdings by geography *and* category in one pass (was two `buildBreakdown` passes), memoized
      on `holdings` alone, and the remaining `exposure` memo just folds in cash/PF and computes
      percentages. `buildBreakdown` now copies (`{ ...exposureGroups[key] }`) rather than mutating —
      folding cash into a memo that survives across renders would double-count on the next
      cash-only recompute, which is what the third test below guards.
      `topMovers` left alone: already `[holdings]`-only, and it's one sort.
      Tests: same file as above. Note the exposure half is a correctness guard, not a
      before/after discriminator — `buildBreakdown` is an inner closure with nothing importable to
      spy on, so the "one pass instead of two, skipped on cash-only changes" win is structural
      rather than directly asserted.

- [x] **Low: Add query timeouts to MCP tool calls.** Done on branch `perf/mcp-tool-call-timeout`,
      merged via [PR #149](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/149).
      New [`withTimeout`](supabase/functions/_shared/timeout.ts) helper (+ a `CallTimeoutError`)
      races an outbound call against a deadline; `portfolio-ai`'s tool-call loop wraps every
      `mcpClient.callTool` in it under a new `MCP_TOOL_CALL_TIMEOUT_MS` (15s).
      **Placed differently than this item proposed, on purpose.** The item suggested a `timeoutMs`
      option on `mapWithConcurrency` itself — but that helper keeps `Promise.all` rejection
      semantics, so a deadline raised *by the pool* would reject the whole batch and discard the
      sibling tool results that did succeed. Wrapping inside the loop's existing `fn` instead means
      a timeout lands in the same `catch` every other tool failure already does: the hung call
      degrades to one error-shaped result the model can reason about, and the turn continues.
      `mapWithConcurrency` is unchanged.
      Also note the diagnosis was slightly understated — a hung call doesn't merely fail to return,
      it parks one of the three workers, so the pool stops picking up the turn's *remaining* calls
      too. Verified: with the wrap removed, the new gate test doesn't just assert a wrong value, the
      turn never completes at all.
      Deliberately does **not** abort the underlying fetch: an `AbortError` is what
      [`retry.ts`](supabase/functions/_shared/retry.ts)'s `isRetryableError` treats as transient, so
      an abort fired inside `McpClient.rpc`'s `withRetry` would be retried with backoff — extending
      the very latency the timeout bounds. Real cancellation needs `withRetry` to tell a deliberate
      abort from a network timeout, which also affects the LLM provider paths; left out of scope and
      documented in `timeout.ts`'s header.
      Tests: [timeout.test.ts](supabase/functions/_shared/timeout.test.ts) (race mechanics, error
      naming vs. the retry classifier, timer cleanup) and a third case in
      [tool-call-concurrency-gate.test.ts](supabase/functions/portfolio-ai/tool-call-concurrency-gate.test.ts)
      proving index.ts actually wires it in.

- [x] ~~**Low: Use `Promise.allSettled()` instead of `Promise.all()` for dev/monitoring
      operations.**~~ — **traced 2026-09-12, the stated problem is a false positive; a different,
      real bug was found in the same code and fixed instead.** Branch
      `fix/dev-zone-deep-check-stuck-spinner`, merged via [PR #151](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/151). `Promise.all` was left exactly as it was in both
      files.
      Why the premise doesn't hold:
      - [Reports.tsx](src/pages/Reports.tsx)'s `Promise.all` wraps two Supabase query builders,
        which resolve `{ data, error }` rather than rejecting — and both `hRes.error` and
        `rRes.error` are *already* checked and logged individually on the next two lines. There is
        nothing for `allSettled` to recover. No change made.
      - [DevZone.tsx](src/pages/DevZone.tsx)'s two fan-outs can't short-circuit either: every job
        already resolves to a status object. `pingEdgeFunction` is try/catch/finally'd end to end,
        each `DEEP_CHECKS` entry converts an `{ error }` invoke result into `{ status: 'error' }`,
        and `deepCheckPortfolioAi` has its own try/catch.
      What *is* real, and was fixed: a rejection didn't discard results, it **stranded the UI in its
      running state**. `runDeepChecks` awaited `getProbeSymbol()` outside any error handling and set
      `setDeepRunning(false)` outside a `finally`, so a network-level throw there (as opposed to the
      PostgREST `{ error }` result it already folds into `null`) left the button frozen on "Running
      deep checks…" with every row reading 'checking' — unrecoverable short of a page reload.
      `runAll` had the identical shape with `setRunning(false)`, which this item didn't mention:
      `supabase.auth.getUser()` rethrows anything that isn't an AuthError, so a raw network failure
      really can escape the Auth core check and disable Recheck permanently.
      Fixed in two halves, because releasing the spinner alone still leaves a dead row: each job now
      absorbs its own rejection into its own row (via `.catch` on the job, not by changing the
      combinator), and each runner releases its spinner from a `finally`/terminal `.then`. If
      `getProbeSymbol` throws, nothing ran at all, so the deep rows are explicitly marked
      "Deep check did not run" rather than left implying work is still in flight. `pingEdgeFunction`
      deliberately gets no `.catch` — it cannot reject, so one would be unreachable.
      Tests: three new cases in [dev-zone.test.tsx](src/test/dev-zone.test.tsx), each confirmed to
      fail against the pre-fix code for the right reason (the deep button's accessible name is
      literally unfindable while stuck, the thrown check's row never updates, Recheck never
      re-enables). Also added an `afterEach(vi.restoreAllMocks)` to that describe block — the new
      tests use persistent `vi.spyOn` mocks that otherwise leak into the following test.

**High Priority Action Items (all resolved 2026-09-11)** — flagged 2026-08-28 during a
Reports-page (`/reports`) calculation audit requested by the user, after confirming and fixing one
instance of this bug class in
[fix/timezone-date-boundary-bug](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/new/fix/timezone-date-boundary-bug)
(`src/lib/periodReports.ts` + `src/pages/Reports.tsx`, using the new
[`parseLocalDate`](src/lib/dateUtils.ts) helper). Root cause: Postgres `DATE` columns
(`transactions.date`, `historical_prices.date`, `benchmark_history.date`, goal `target_date`) come
back as bare `'YYYY-MM-DD'` strings with no time/offset. `new Date(dateString)` parses those per the
ISO-8601 spec as **UTC midnight**, which is a different instant from the **local midnight** every
other point-in-time `Date` in this app is built with (`new Date(y, m, d)`, `new Date()`). In a
timezone ahead of UTC (verified under Asia/Calcutta, UTC+5:30) that skew silently drops or
misclassifies a row whose date exactly matches the comparison boundary.
**Decision (2026-09-04):** fixed `RollingReturns.tsx` and `GoalTrack.tsx`'s days-left bug first
(each on its own branch off `main`, per repo convention); held `taxCalculator.ts` back — and,
since it was found to be the same class of tax-number-affecting bug, `GoalTrack.tsx`'s
`getHoldingLotSplit` too — for a separate, more careful review pass. All items below trace back to
this audit.

- [x] **Fix the `taxCalculator.ts` LTCG/STCG and `GoalTrack.tsx` `getHoldingLotSplit` threshold
      day-count bugs** — the two items held back by the "Decision (2026-09-04)" above, fixed
      together since they're the same bug class flagged in the same review pass.
      `computeLotsForSymbol` ([`src/lib/taxCalculator.ts`](src/lib/taxCalculator.ts))
      and `getOpenLots` ([`src/pages/GoalTrack.tsx`](src/pages/GoalTrack.tsx)) each parsed a bare
      Postgres DATE string (`transactions.date`) with `new Date(dateString)` — UTC midnight, a
      different instant from the local-midnight `today`/`Date.now()` each holding period is
      compared against — undercounting elapsed days by the local/UTC offset and able to flip a lot
      sitting within that margin of the 365/730-day LT/ST threshold. Both now parse with the
      existing [`parseLocalDate`](src/lib/dateUtils.ts) helper, the same fix already used for
      `periodReports.ts`/`PortfolioCharts.tsx` below. Branch:
      `fix/tax-lot-date-boundary-misclassification`, merged via
      [PR #140](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/140) (the fix) and
      [PR #141](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/141) (this TODO
      cleanup). Tests: new boundary case in
      [tax-calculator.test.ts](src/test/tax-calculator.test.ts) and new
      [goal-track-holding-lot-split-date-boundary.test.ts](src/test/goal-track-holding-lot-split-date-boundary.test.ts)
      — each confirmed to fail against the pre-fix parse and pass against the fix.

- [x] Fix the `RollingReturns.tsx` window-boundary bug — `fix/date-boundary-rolling-returns`, commit
      `8505752`. Fixed in both `computeWindowXIRR` *and* the previously-inline `portfolioWindowXIRR`
      (the TODO only named the former; both had the identical pattern, in three places total).
      `portfolioWindowXIRR` is now a standalone exported function so it's directly unit-tested.
      Tests: [rolling-returns.test.ts](src/test/rolling-returns.test.ts).

- [x] ~~Fix the `benchmarkXirr.ts` price-lookup bug~~ — **traced 2026-09-04, cleared, not a bug.**
      `priceOnOrBefore` compares `new Date(p.date)` against a `date` argument that, at every call
      site, is itself always `new Date(t.date)` — another bare DATE-only string, never a real
      `Date.now()`/`new Date()` instant. The UTC-midnight misparse is a constant +5:30 offset
      applied identically to both sides of the comparison, so it cancels out and never changes
      ordering — the same false-positive pattern already found for `chartRange.ts` below. No code
      change made.

- [x] Fix the `GoalTrack.tsx` days-remaining bug — `fix/date-boundary-goaltrack-daysleft`. Both the
      goal-card badge and the detail dialog's "Days Left" stat now parse `target_date` with
      `parseLocalDate`. `goal.created_at` (a real `timestamptz`, not a DATE-only column) is
      untouched. Tests: [goal-track-date-boundary.test.tsx](src/test/goal-track-date-boundary.test.tsx).

- [x] Evaluate OpenRouter + Nemotron plan — see
      [docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md). Opt-in Nemotron/MiniMax
      path shipped and live (PRs #105-108); auto-escalation default still pending the bench-off
      documented in that doc's task 9.

- [x] **Groq 429 error-surfacing — already done, pre-dates this TODO item.** Checked
      2026-09-01: [`chat-error-classifier.ts`](supabase/functions/_shared/chat-error-classifier.ts)
      already maps a 429 `HttpCallError` to a distinct `rate_limited` category ("The AI service is
      receiving a high volume of requests right now. Please wait a few seconds and try again."),
      separate from the generic `unknown`/`upstream_unavailable` messages — wired into both the
      mid-stream SSE error path ([sse.ts:39](supabase/functions/_shared/sse.ts)) and the pre-stream
      top-level catch in
      [portfolio-ai/index.ts:405](supabase/functions/portfolio-ai/index.ts). `withRetry` still
      retries the 429 with backoff first; only once attempts are exhausted does the original
      `HttpCallError(429)` propagate and get classified. Landed in commit `a6b1a9f`
      ("fix: classify LLM/MCP-server error statuses into specific end-user messages"),
      2026-08-23 — before this backlog item was written, so the item was stale rather than
      describing real outstanding work. No code changes made.

- [x] **#1 — Reconcile dashboard XIRR-breakdown benchmark numbers with the `/benchmark` page.**
      Resolved by labeling, not unifying (option 2 of the two below) — the user picked this over
      replicating the cash-flow-replay methodology on `/benchmark`, since the two numbers answer
      genuinely different questions. `XirrDetailsCard`'s benchmark section now states on-screen
      that it's a whole-history cash-flow-replay XIRR, distinct from `/benchmark`'s windowed
      simple return, with a link to that page; `/benchmark`'s header `InfoHint` caveat now says
      the same in the other direction. See [docs/xirr-breakdown.md](docs/xirr-breakdown.md)'s new
      "Why this contradicts the `/benchmark` page, and why that's fine" section for the full
      writeup, and [src/test/xirr-details-card.test.tsx](src/test/xirr-details-card.test.tsx) for
      coverage. Branch: `docs/reconcile-xirr-benchmark-labels` (PR not yet opened).
      <details><summary>Original item</summary>

      The dashboard's XIRR stat card ([XirrDetailsCard.tsx](src/components/XirrDetailsCard.tsx),
      added in [feat/xirr-breakdown](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/new/feat/xirr-breakdown))
      shows NIFTY 500 / S&P 500 XIRR computed by replaying every real transaction as a buy/sell of
      the index on the same date/amount
      ([`computeBenchmarkXirr`](src/lib/benchmarkXirr.ts)) — e.g. currently NIFTY 500 +7.47%,
      S&P 500 +20.77%, vs. Overall/Portfolio XIRR +7.72%.
      The `/benchmark` page ([Benchmark.tsx](src/pages/Benchmark.tsx)) computes a *different*
      metric for a *different* scope: simple first-vs-last-snapshot % return (not XIRR) over
      `net_worth_history`/`benchmark_history`, restricted to a selected window (30/90/180/365
      days), and explicitly holdings-value-only (excludes cash, PF, liabilities — see its own
      `InfoHint` caveat). Two different methodologies + two different measurement windows means
      the two pages will contradict each other for the same symbols, with no explanation on
      screen of why. Needs one of:
        1. Replicate the dashboard's cash-flow-replay XIRR methodology on `/benchmark` (as an
           additional stat alongside its existing windowed-return figure), or
        2. Explicitly label both pages with what each number does/doesn't measure so the
           difference reads as "different question," not "bug."
      Flagged by the user after reviewing the dashboard XIRR breakdown — see chat history around
      2026-08-26.
      </details>

- [x] Async / bounded concurrency — [PR #TBD](https://github.com/ak18akashrajr/financial-analyst-mcp/pulls):
      `portfolio-ai`'s tool-call loop now runs a turn's independent tool calls concurrently
      (bounded by `MAX_CONCURRENT_TOOL_CALLS = 3`) via a new
      [`mapWithConcurrency`](supabase/functions/_shared/concurrency.ts) helper, instead of
      awaiting them one at a time.

- [x] Retries with backoff — [`withRetry`](supabase/functions/_shared/retry.ts): wraps the outbound
      fetch in `GroqProvider.runTurn`, `AnthropicProvider.runTurn`, and `McpClient`'s `rpc()`
      (used by `initialize`/`listTools`/`callTool`) with exponential backoff + full jitter, up to
      3 attempts by default. Only retries what's actually transient — a 429/5xx/529 status, a
      timeout, or a fetch()-level network failure — a genuinely bad request (400/401/403/404/
      413/422) fails immediately, same as before. Safe because every wrapped call is read-only
      (every MCP tool is a SELECT; an LLM chat-completion call has no side effect). Tests:
      [retry.test.ts](supabase/functions/_shared/retry.test.ts) for the backoff/retry mechanics in
      isolation, plus updated coverage in provider-error.test.ts and mcp-client.test.ts for the
      actual fetch-call-count behavior.

- [x] **Expense-to-Income Ratio, auto-tracked from bank balance updates.** New
      [`monthly_cashflow`](supabase/migrations/20260826120000_add_monthly_cashflow.sql) table
      (one row per IST calendar month — a new month simply has no row yet, so tracking resets
      automatically with no cron job). `usePortfolio.ts`'s `updateCash` now classifies every
      Operating Cash / Cash Reserve delta as income (increase) or expense (decrease) — see
      [`classifyBalanceDelta`](src/lib/expenseIncomeRatio.ts) — unless the edit is marked
      `excludeFromCashflow` (a new checkbox on those two cards in
      [CashSection.tsx](src/components/CashSection.tsx), for corrections/transfers). PF and
      credit-card-debt edits never feed it; `payCreditCardBill` always excludes itself (the real
      spending already happened when the card was charged) so settling a bill doesn't double-count
      as an expense. New [ExpenseIncomeRatioCard.tsx](src/components/ExpenseIncomeRatioCard.tsx)
      on the dashboard shows this month's ratio with the requested tiered bands (&lt;50% Ideal,
      50–75% Manageable, &gt;75% High Risk). Also relocated the "Settle Now" liability button off
      the Cash Management section header and onto the Credit Card box itself, per feedback that its
      old position was disconnected from the debt it settles. Tests:
      [expense-income-ratio.test.ts](src/test/expense-income-ratio.test.ts),
      [use-portfolio-cashflow-tracking.test.tsx](src/test/use-portfolio-cashflow-tracking.test.tsx),
      [cash-section.test.tsx](src/test/cash-section.test.tsx),
      [expense-income-ratio-card.test.tsx](src/test/expense-income-ratio-card.test.tsx).

- [x] **XIRR → time-to-double.** [XirrDetailsCard.tsx](src/components/XirrDetailsCard.tsx)'s
      breakdown rows (Overall, ex-PF, and each benchmark) now show years-to-double next to the XIRR
      figure — exact `ln(2) / ln(1+xirr)`, not the rough Rule-of-72 mental-math shortcut (see
      [timeToDouble.ts](src/lib/timeToDouble.ts)). Sub-year durations render in months (e.g.
      "6.0mo to double"); a zero or negative XIRR renders "—" since it never doubles. Tests:
      [time-to-double.test.ts](src/test/time-to-double.test.ts) for the formula, plus new coverage
      in [xirr-details-card.test.tsx](src/test/xirr-details-card.test.tsx).

- [x] **AUM target: ₹50L by March 2028, on the net-worth chart.**
      [NetWorthChart.tsx](src/components/NetWorthChart.tsx) — added the simpler static version
      (no projected pace-to-target line): a dashed `ReferenceLine` at ₹50L labeled
      "Goal: ₹50L (Mar 2028)", the Y-axis domain extended so the goal line is always visible even
      while AUM is well below it, and a "`X.X`% of ₹50L goal (Mar 2028)" line next to the chart
      heading, computed from the same `currentNetWorth` prop the chart already uses (holdings +
      cash − liabilities). Both the goal label and the % figure respect privacy-hide mode. Tests:
      [net-worth-chart-goal.test.tsx](src/test/net-worth-chart-goal.test.tsx).

- [x] **Wire A2UI into AI Agent frontend response.** Resolved as a frontend-only,
      A2UI-inspired restyle, not the real [A2UI](https://a2ui.org/) protocol — confirmed via
      `google/A2UI`/a2ui.org that a genuine A2UI renderer (`@a2ui/react`) consumes a structured
      JSON envelope (`createSurface`/`updateComponents`/`updateDataModel` against a component
      catalog) that has to originate server-side, which `portfolio-ai`'s SSE stream doesn't emit
      (`delta` chunks are plain Markdown, `tool_call` only carries `{name, args}`). Rather than
      change the SSE contract, added
      [`AssistantMarkdown`](src/components/portfolio-ai/AssistantMarkdown.tsx) as a drop-in
      replacement for the bare `<ReactMarkdown remarkPlugins={[remarkGfm]}>` in
      [PortfolioAI.tsx](src/pages/PortfolioAI.tsx): GFM tables render as bordered card containers
      with zebra rows, right-aligned/`tabular-nums` numeric columns, and sign-colored gain/loss
      cells (`+2.3%` → emerald, `-1.1%` → rose, based on the leading `+`/`-`); blockquotes render
      as a left-accented callout card; inline code gets a pill background. Tests:
      [portfolio-ai-markdown.test.tsx](src/test/portfolio-ai-markdown.test.tsx). Branch:
      `feat/portfolio-ai-a2ui-markdown-rendering`.

- [x] **`src/lib/chartRange.ts:94-95` — cleared, not a bug.** Traced (2026-08-28, as part of the
      Reports-page timezone-date-boundary audit) `computeRangeXIRR`'s only DATE-only-column caller
      (`PortfolioCharts.tsx`'s `dateKey='date'` usage): its chart points are keyed by
      `t.date.split('T')[0]` (the raw transaction date string, untouched), and the transactions
      compared against them are parsed via bare `new Date(t.date)` — both sides use the identical
      (UTC) parse of the identical kind of string, so the skew is applied uniformly to both sides
      and cancels out. `NetWorthChart.tsx`'s other call site uses `recorded_at`, a `timestamptz`
      column (a real instant, not a bare DATE) — also not affected. No fix needed.

- [x] **`src/components/PortfolioCharts.tsx:108` — confirmed and fixed**, in
      [fix/timezone-date-boundary-bug](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/new/fix/timezone-date-boundary-bug)
      (2026-08-28, same audit as above). `new Date().toISOString().split('T')[0]` gave the *UTC*
      calendar date to decide "does the timeline already have a point for today," while every other
      point on that timeline is keyed by the transaction's own (locally-meant) date string — wrong
      for the ~5.5 hours after local midnight (00:00–05:29 IST), where the UTC date is still
      "yesterday." Fixed with a new [`todayLocalDateString`](src/lib/dateUtils.ts) helper (local
      calendar date, zero-padded to the same `'YYYY-MM-DD'` shape). Cosmetic-only impact (a
      stale/missing "as of now" chart point during that window, never a wrong money figure) — fixed
      anyway since it was low-effort once traced. Tests:
      [dateUtils.test.ts](src/test/dateUtils.test.ts).

- [x] **Fix finding #10 (security-review.md) — a hijacked/replayed session can silence or delete
      its own `security_incidents` row, and re-baseline `session_fingerprints`, using nothing but
      the stolen token itself.** Flagged 2026-08-29 during an adversarial security re-scan (third
      pass) of [docs/security-review.md](docs/security-review.md). Fixed in
      [20260830090000_harden_session_hijack_rls.sql](supabase/migrations/20260830090000_harden_session_hijack_rls.sql)
      on branch `fix/session-hijack-rls-anti-tamper`: `session_fingerprints` now has no
      `authenticated`-facing policy at all (client never touched it anyway — only the
      `SECURITY DEFINER` trigger does); `security_incidents` keeps `SELECT` but its `UPDATE` policy
      plus a new `BEFORE UPDATE` guard trigger restrict a client write to flipping `acknowledged`
      to `true` and nothing else; `DELETE`/`INSERT` revoked from `authenticated` on both tables. See
      [docs/security-review.md](docs/security-review.md)'s 2026-08-30 remediation log entry.
      **Verified live** against the real Supabase project (2026-08-30): the exploit's own `curl`
      reproduction now correctly gets `204` for the legitimate acknowledge-only shape, `400`
      (`P0001`, guard trigger) for a PATCH that also touches `ip`, `403` (`42501`) for `DELETE`, and
      an empty result for any `session_fingerprints` read — confirmed via DevZone's Security tab
      that the real acknowledge flow and incident display are unaffected.

- [x] **Sanitize raw Postgres error text before it can reach the chat.** Flagged 2026-09-08 during
      the repo-wide security scan above, as an open decision rather than a firm bug — resolved by
      generalizing the message (over leaving it as-is). Branch `fix/portfolio-mcp-error-sanitization`;
      see [docs/security-review.md](docs/security-review.md)'s Fourth pass, finding #13, for the
      full writeup. `assertNoError` in
      [`_shared/portfolio-data.ts`](supabase/functions/_shared/portfolio-data.ts) now logs the raw
      Postgrest error server-side (via the module's existing logger) instead of embedding
      `error.message` in the thrown `Error`; the thrown/propagated message is now `` `${context}: a
      database error occurred` `` — no schema detail can reach `portfolio-mcp-server`'s `isError`
      result or an LLM-paraphrased chat reply. Tests:
      [`portfolio-data.test.ts`](supabase/functions/_shared/portfolio-data.test.ts) — new case
      asserts the raw simulated error text is absent from the thrown message and still present in
      the server-side log.

- [x] **Add a request-size cap to `portfolio-ai`.** Flagged 2026-09-08 during the same scan —
      closes out that section's last open item. Branch `fix/portfolio-ai-request-size-cap`; see
      [docs/security-review.md](docs/security-review.md)'s Fourth pass, finding #14, for the full
      writeup. [`portfolio-ai/index.ts`](supabase/functions/portfolio-ai/index.ts) now rejects a
      `messages` array over `MAX_MESSAGES` (200) entries, or any message whose `content` exceeds
      `MAX_MESSAGE_CONTENT_LENGTH` (8,000 chars), with a 400 — before any (billed) provider call is
      made. The existing per-minute rate limiter bounds request *count*; this bounds payload *size*
      per request. Tests:
      [`request-size-cap.test.ts`](supabase/functions/portfolio-ai/request-size-cap.test.ts) — new
      file covering the over-limit array, the over-limit message, and a boundary case exactly at
      both limits.

- [x] **All risk ratios added (Alpha, Beta, Volatility, Sharpe Ratio).** Volatility and Beta already
      existed in [`getRiskMetrics`](supabase/functions/_shared/portfolio-data.ts); added Jensen's
      Alpha (CAPM) and Sharpe Ratio alongside them, both per-holding and portfolio-level, in the
      same function and its `get_risk_metrics` MCP tool
      ([mcp-tools.ts](supabase/functions/_shared/mcp-tools.ts)) — so the portfolio AI can report all
      four for the same question. Risk-free rate: the 10Y India G-Sec yield (6.95%), matching
      `INDIA_10Y_GSEC_YIELD` already used for the Deploy page's equity-risk-premium calc (duplicated
      as its own constant since this Deno edge function can't import from `src/`); surfaced back as
      `riskFreeRatePercent` so the assumption is never left implicit. Sharpe is `null` (not an
      infinite/0 value) for a zero-volatility holding; Alpha/Beta stay `null` until NIFTY 50
      benchmark data exists, the same gating the existing volatility/beta fields already used.
      **Note:** this Alpha is the statistical CAPM "risk ratio" sense of the word — a different
      metric from the "Realized & Unrealized Alpha" (SummaryBar) / "Alpha (USD)"
      (DollarAdjustedReturns) already shown elsewhere in the app, both of which are just raw P&L
      under the same name; every place the new Alpha is surfaced calls this out explicitly.
      Also added a new frontend page, [`/risk-metrics`](src/pages/RiskMetrics.tsx) (sidebar:
      Analytics → Risk Metrics), showing all four metrics with tooltips, fixed to the same 90-day
      lookback `get_risk_metrics` defaults to so the page and the AI always agree. Calculation logic
      is duplicated as a pure, unit-tested module ([`src/lib/riskMetrics.ts`](src/lib/riskMetrics.ts))
      rather than imported from the edge function — same pattern already used for
      `compareToBenchmark` vs. `Benchmark.tsx`. Tests:
      [`portfolio-data.test.ts`](supabase/functions/_shared/portfolio-data.test.ts) (new Alpha/Sharpe
      cases) and [`risk-metrics.test.ts`](src/test/risk-metrics.test.ts).
      **Follow-up (same branch):** added a fifth, frontend-only figure per the user's request for a
      "unit economics" reading — **Risk per ₹1 of Return** (`riskPerRupeeOfReturn` in
      `src/lib/riskMetrics.ts`) = annualized Volatility ÷ annualized Return, shown on `/risk-metrics`
      only (not added to the `get_risk_metrics` MCP tool, by the user's choice). Null whenever the
      return is zero or negative — the ratio isn't meaningful without real profit to divide the risk
      by. Uses the same trailing-90-day return already computed for Alpha/Sharpe (not the app's
      separate all-time cost-basis P&L figure), so it stays on the same apples-to-apples basis as the
      other four ratios. Tests: new cases in `risk-metrics.test.ts`. Branch:
      `feat/risk-metrics-alpha-sharpe`, merged via
      [PR #144](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/144).

- [x] **Cap `forecast_portfolio_value`'s `horizonMonths` — unbounded CPU-exhaustion risk.**
      Flagged 2026-09-17 during a repo-wide security scan requested by the user (covering
      everything shipped since the 2026-09-08 review: time-series forecasting, cash inline-edit,
      the new `llm_requests` log table, the clarifying-question tool, MCP-call timeout). Everything
      else in that scan checked out clean; this was the one genuine finding.
      [`mcp-tools.ts`](supabase/functions/_shared/mcp-tools.ts)'s `horizonMonths` schema had only
      `minimum: 1`, no upper bound, and
      [`mcp-schema-validate.ts`](supabase/functions/_shared/mcp-schema-validate.ts)'s `validateArgs`
      had no `maximum` keyword support at all — so even adding one to the schema alone wouldn't
      have been enforced. An LLM-supplied `horizonMonths` in the millions would reach
      [`forecastParametricTerminal`](supabase/functions/_shared/forecast.ts)'s
      `simulations(1000) × months` synchronous loop uncapped, pinning that edge function's CPU;
      [`timeout.ts`](supabase/functions/_shared/timeout.ts) doesn't cancel the underlying call by
      design, so the runaway loop would keep burning compute even after `portfolio-ai`'s
      client-side timeout gave up and showed the user an error. Fixed on branch
      `fix/security-scan-followups-sept17`: added real `maximum` support to `validateArgs`, and set
      `maximum: 120` (10 years — double the largest horizon the Forecast page itself ever offers,
      `HORIZON_OPTIONS` topping out at 60 in `src/pages/Forecast.tsx`) on the tool's own schema.
      Tests: new cases in
      [`mcp-schema-validate.test.ts`](supabase/functions/_shared/mcp-schema-validate.test.ts)
      (`maximum` accepted at the boundary, rejected above it) and
      [`mcp-tools.test.ts`](supabase/functions/_shared/mcp-tools.test.ts) (the tool's own schema
      rejects an excessive `horizonMonths`).

- [x] **Patch `js-yaml` (high-severity `npm audit` finding).** Same 2026-09-17 scan. Transitive
      dev dependency via `eslint` → `@eslint/eslintrc` → `js-yaml`
      ([GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh), CPU-DoS via
      `maxTotalMergeKeys` on empty merge sources) — not shipped runtime code either way. Patched
      4.3.1 → 4.3.2 via plain `npm audit fix` (no `--force`, no major bump). See the Security
      section above for the one `npm audit` item from this same pass that's still open
      (`vitest`/`@vitest/mocker`, blocked on an upstream bug, not this fix).

</details>
