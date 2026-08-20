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
([Updates.tsx](../src/pages/Updates.tsx)), drag-to-select point-to-point chart returns, a benchmark
comparison page plotting AUM against NIFTY 50/500/S&P 500 ([Benchmark.tsx](../src/pages/Benchmark.tsx)),
annualized XIRR on the chart drag-select badge for the cash-flow-backed charts
([ChartRangeBadge.tsx](../src/components/charts/ChartRangeBadge.tsx),
[chartRange.ts](../src/lib/chartRange.ts)), and tax-loss harvesting flags on the Taxes page
([taxCalculator.ts](../src/lib/taxCalculator.ts)).

---

## 2. Rebalancing suggestions
**Why:** `get_exposure_drift` and `get_concentration_risk` MCP tools already compute how far your
allocation has drifted and how concentrated you are, but only the AI chat can surface it — there's
no actionable "do this" view.
**What it'd look like:** a card/page that turns drift into concrete suggestions — "Equity is 8%
over target; consider trimming ₹X" — reusing the same computations the MCP tools already do in
`_shared/portfolio-data.ts`.
**Effort:** medium — needs you to define target allocations somewhere (a new small settings
table), then a diff view.

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
With the benchmark comparison page, the annualized XIRR badge, and tax-loss harvesting flags all
shipped, and scheduled alerts, downloadable reports, CSV import/export, and a watchlist all
descoped as not wanted, the two remaining items are **#2 (rebalancing suggestions)** and
**#9 (performance attribution)** — both are
additive over computations that already exist (`_shared/portfolio-data.ts`'s exposure/drift logic,
and `usePortfolio.ts`'s per-holding P&L) and need no new external account. **#10 (MCP tool-result
caching)** stays shelved until an Upstash account exists.
