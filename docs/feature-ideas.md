# Feature ideas backlog

A grounded list of things we could build next, checked against what's already shipped so nothing
here duplicates existing work. Pick whichever sound useful and we'll scope each into its own plan
before building.

**Already built, so intentionally not re-suggested:** Goals + goal-linked Monte Carlo projections
([GoalTrack.tsx](../src/pages/GoalTrack.tsx), [GoalProjection.tsx](../src/components/projections/GoalProjection.tsx)),
tax report / capital gains ([Taxes.tsx](../src/pages/Taxes.tsx), [taxCalculator.ts](../src/lib/taxCalculator.ts)),
PE-based deployment signal ([DeploymentPlan.tsx](../src/pages/DeploymentPlan.tsx)),
FIRE / stress-replay / SIP optimizer ([FireModule.tsx](../src/components/projections/FireModule.tsx),
[StressReplay.tsx](../src/components/projections/StressReplay.tsx)),
PF + credit card debt tracking, rolling XIRR, dollar-adjusted returns, a changelog
([Updates.tsx](../src/pages/Updates.tsx)), and drag-to-select point-to-point chart returns (just shipped).

---

## 0. Auto-sync cash balances from UPI transactions (priority)
**Why:** `liquidCash` (Operating Cash) and `vaultCash` (Cash Reserve, ICICI savings) in
`cash_settings` are entered by hand today ([CashSection.tsx](../src/components/CashSection.tsx)) —
every UPI debit/credit means a manual edit or the number drifts from reality.
**What it'd look like:** pull UPI transaction history for both bank accounts on a schedule (or on
demand) and reconcile it against `liquidCash`/`vaultCash` automatically — either adjusting the
stored balance directly or posting matching entries to a transaction ledger so the adjustment is
auditable.
**Effort:** unclear until the data-source question below is answered — this is the one feature
here that depends on an external integration decision rather than just more code over existing
data.
**Decided (2026-08-19):**
- **Scope:** `liquidCash` (Operating Cash) and `vaultCash` (Cash Reserve). `pfBalance` stays
  manual — PF/PPF/EPF has no UPI activity, out of scope.
- **Flow:** review queue, not silent auto-apply — detected transactions land as "pending," you
  approve before any balance changes.
- **Storage:** ledger entries, not a raw balance overwrite — each synced transaction becomes an
  auditable row (same shape as the existing `transactions` table pattern), and the cash balance
  becomes a derived total on top of that.
- **Data source — building Phase 1 now, Phase 2 explicitly queued:**
  - **Phase 1 (build target):** periodic ICICI bank statement upload (CSV/XLS export from
    netbanking, done by hand) parsed into pending ledger rows in the review queue. No external
    integration, no credentials ever touch the app, reuses the same parsing/validation shape as
    backlog item #7 (CSV import). Fully within the app's existing security posture — this is what
    gets scoped/built first.
  - **📌 Phase 2 — planned upgrade, not yet started:** replace the manual export step with Gmail
    API read-access that parses ICICI's transaction-alert emails straight into the same pending
    queue, so sync no longer requires you to remember to export a statement. Adds inbox-read as a
    new trust boundary, so this should only be picked up once Phase 1's parsing/review UI has been
    used for a while and proven reliable. Revisit this explicitly rather than letting Phase 1 be
    treated as the final state.
  - *Ruled out:* the RBI Account Aggregator framework (Setu/Finvu/OneMoney) is the "textbook
    correct" regulated path, but production data-pull access is normally gated behind being a
    registered Financial Information User (FIU) — a licensed financial entity, not an individual
    developer. Sandbox access exists but won't pull real account data. Only worth revisiting if
    that access constraint turns out not to apply.
  - Screen-scraping via entered net-banking/UPI-app credentials is off the table outright —
    credential entry is a hard no under this app's operating rules.

## 1. Benchmark comparison page
**Why:** the `compare_to_benchmark` MCP tool already exists
([mcp-tools.ts](../supabase/functions/_shared/mcp-tools.ts)) and benchmark price history is
already being fetched and stored (`fetch-benchmark-prices` edge function, `benchmark_history`
table) — but you can only see this by asking the AI chat. There's no chart.
**What it'd look like:** a page (or a section on Reports/Charts) plotting your AUM/XIRR against
NIFTY 50 (or another index) over the same period, using data that's already flowing in.
**Effort:** small–medium — mostly UI; the query/comparison logic already exists.

## 2. Rebalancing suggestions
**Why:** `get_exposure_drift` and `get_concentration_risk` MCP tools already compute how far your
allocation has drifted and how concentrated you are, but only the AI chat can surface it — there's
no actionable "do this" view.
**What it'd look like:** a card/page that turns drift into concrete suggestions — "Equity is 8%
over target; consider trimming ₹X" — reusing the same computations the MCP tools already do in
`_shared/portfolio-data.ts`.
**Effort:** medium — needs you to define target allocations somewhere (a new small settings
table), then a diff view.

## 3. Tax-loss harvesting flags
**Why:** `taxCalculator.ts` already builds per-symbol `TaxLot`s with cost basis and current value.
Nothing currently flags which lots are sitting at a loss and could be harvested before FY-end.
**What it'd look like:** a section on the existing Taxes page listing lots below cost, with the
harvestable loss amount and the wash-sale-style caveat (India doesn't have a formal wash-sale
rule, but re-buying the same stock same-day is worth flagging).
**Effort:** small — additive to an existing page and existing data structures.

## 4. Scheduled limit-breach alerts
**Why:** `check_limit_breaches` is a pull-only MCP tool today — you only find out if you think to
ask the AI. A single-user app doesn't need real-time alerting, but a daily check costs nothing.
**What it'd look like:** a cron-scheduled edge function (same pattern as the existing deploy
workflow's manual-trigger setup) that runs `check_limit_breaches` once a day and emails you (or
just logs, if you'd rather check a page) when something's breached.
**Effort:** medium — new edge function + a cron trigger + (optional) email delivery setup.

## 5. Downloadable period reports
**Why:** `periodReports.ts` already builds a full `PeriodSnapshot`/`PeriodActivity` per FY/quarter
for the Reports page — but it's only viewable in-browser, not something you can save or share.
**What it'd look like:** an "Export" button on Reports.tsx producing a PDF or XLSX of the current
period's numbers, reusing data already computed for the page.
**Effort:** small–medium — presentation layer over data that already exists.

## 6. Annualized XIRR on the chart drag-select badge
**Why:** the point-to-point return feature just shipped uses a simple % change by design (works on
every chart uniformly). For the three cash-flow-backed charts (NetWorthChart, PortfolioCharts,
DebtChart) specifically, a toggle to show real annualized XIRR for the dragged window would be
more financially precise — this was explicitly deferred as a v2 in that feature's plan.
**What it'd look like:** an optional second line in `ChartRangeBadge` using `buildSnapshot()` +
`calculateXIRR()` for the selected date range, shown only where cash-flow data exists.
**Effort:** small — additive to code that already exists ([ChartRangeBadge.tsx](../src/components/charts/ChartRangeBadge.tsx)).

## 7. CSV import / export of transactions
**Why:** every transaction currently has to be entered one at a time through the UI
([usePortfolio.ts](../src/hooks/usePortfolio.ts)'s `addTransaction`). Bulk-loading history (e.g.
from a broker statement) or backing up your data has no path today.
**What it'd look like:** an import screen that parses a CSV into the `Transaction` shape and bulk
inserts, plus an export button that dumps current transactions to CSV.
**Effort:** medium — needs careful validation (dates, symbol matching) but no new backend.

## 8. Watchlist for symbols you don't own yet
**Why:** `fetch-prices`/`fetch-historical-prices` already know how to pull quotes for any symbol;
today that's only exercised for symbols you actually hold.
**What it'd look like:** a simple list of tracked-but-not-owned symbols with live price and %
change, reusing the existing price-fetch edge functions.
**Effort:** small — mostly a new small table + a page reusing existing fetch functions.

## 9. Performance attribution ("what drove my returns")
**Why:** you can see overall XIRR and per-holding P&L, but nothing decomposes total portfolio
return into "which holdings contributed how much."
**What it'd look like:** a breakdown (bar chart, biggest contributors/detractors) computed from
existing per-holding P&L data in `usePortfolio.ts`'s derived holdings.
**Effort:** small–medium — mostly a new computation over data you already have in memory.

## 10. Scoped MCP tool-result caching (Upstash Redis)
**Why:** discussed and shelved for now — needs you to create a free Upstash account and store two
secrets first. Revisit this once the account exists; the design (TTL-only, ~45s, cache the
no-dynamic-arg MCP tools) was already scoped in this conversation.
**Effort:** small once the account exists — one new `_shared` module, no new tables.

---

### Suggested order, if you want a recommendation
Start with **#1 (benchmark comparison)** and **#6 (annualized XIRR badge)** — both are the
smallest, most directly reuse code that already exists, and neither needs a new table or external
account. **#3 (tax-loss flags)** is a close third for the same reason.
