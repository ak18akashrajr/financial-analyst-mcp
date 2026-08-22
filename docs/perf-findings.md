# Performance Findings

**Status:** findings only — nothing here is implemented. Written 2026-08-22, as a follow-up sweep
after fixing the `current_prices` write-amplification bug (see
[scaling-and-archival-plan.md's addendum](scaling-and-archival-plan.md#2026-08-22--implemented-skip-no-op-writes-to-current_prices)):
once one instance of "writes unconditionally when nothing changed" turned up, it was worth checking
whether the same shape existed anywhere else. This is a report to pick from, not a task list to
work through in order — see each finding's severity, picked against this app's actual scale (a
single user, not a high-traffic service).

## 1. `net_worth_history` inserts a new row on every edit, even a no-op one — Medium

**File:** [`src/hooks/usePortfolio.ts:109-125`](../src/hooks/usePortfolio.ts) (`recordNetWorthSnapshot`),
called unconditionally from `addTransaction`, `updateTransaction`, `deleteTransaction`, and
`updateCash`.

`recordNetWorthSnapshot` always does `supabase.from('net_worth_history').insert(...)` — there's no
check against the most recently stored snapshot. Editing a transaction's date, correcting a typo
back to its original value, or re-saving cash settings with identical numbers all insert a brand
new row. This directly contradicts
[`scaling-and-archival-plan.md`](scaling-and-archival-plan.md)'s own growth-model assumption that
this table gets "one snapshot per day (at most)" — nothing in the code actually enforces that.
It's the same shape as the `current_prices` bug just fixed: a table meant to represent
meaningful change-over-time events, written unconditionally instead of on an actual change.

**Fix idea:** before inserting, compare the computed `netWorth` (and/or its component fields) to
the most recent `net_worth_history` row for the current day and skip the insert if unchanged —
same pattern as `_shared/price-diff.ts`'s `selectPricesToWrite`.

## 2. `Charts` page fetches the whole portfolio twice — Low

**Files:** [`src/pages/Charts.tsx:17-24`](../src/pages/Charts.tsx) and
[`src/components/CorrelationHeatmap.tsx:40`](../src/components/CorrelationHeatmap.tsx).

`Charts.tsx` calls `usePortfolio()` (which fetches `transactions`, `cash_settings`,
`current_prices`, `symbol_metadata`), and also renders `<CorrelationHeatmap />`, which
independently calls `usePortfolio()` again just to get `transactions`. Since `usePortfolio` isn't
backed by a shared cache/context, mounting `CorrelationHeatmap` re-runs all four queries a second
time on every visit to `/charts`.

**Fix idea:** have `CorrelationHeatmap` accept `transactions` as a prop from its parent instead of
calling `usePortfolio()` itself.

## 3. `CorrelationHeatmap` reads all of `historical_prices`, unfiltered — Low-Medium

**File:** [`src/components/CorrelationHeatmap.tsx:51-54`](../src/components/CorrelationHeatmap.tsx).

```ts
const { data } = await supabase.from('historical_prices').select('symbol,date,close').order('date', { ascending: true });
```

No `.in('symbol', symbols)` filter and no date bound — every row for every symbol ever fetched
anywhere in the app comes back, then gets filtered client-side. `RollingReturns.tsx` already does
the symbol-scoped version of this same query; this one instance doesn't. Not costly today (the
table is still small), but it's the one client-side full-table read on `historical_prices` not
already covered in the scaling plan, and it'll grow with tracked-symbol count.

**Fix idea:** add `.in('symbol', symbols)`, mirroring `RollingReturns.tsx`.

## 4. `get_risk_metrics` queries `historical_prices` once per holding, sequentially — Low

**File:** [`supabase/functions/_shared/portfolio-data.ts:253-269`](../supabase/functions/_shared/portfolio-data.ts)
(`getRiskMetrics`'s loop calling `fetchDailyReturns`, defined at line 179).

For N holdings, this is N separate `historical_prices` queries, `await`ed one at a time inside a
`for` loop rather than batched or run concurrently. Only triggered by an explicit `portfolio-ai`
chat tool call (`get_risk_metrics`), for a single user, on a realistically small holdings count —
so this is a per-call latency cost, not a database load problem.

**Fix idea:** fetch `historical_prices` once with `.in("symbol", holdings.map(h => h.symbol))` and
group the results by symbol in memory, or at minimum wrap the loop body in `Promise.all` so the
per-symbol queries run concurrently instead of serially.

## 5. No route-based code splitting — Low

**File:** [`src/App.tsx:7-19`](../src/App.tsx).

All 12 page components are statically imported with no `React.lazy`/`Suspense`, and several of
them (`Charts`, `Projections`, `RollingReturns`, `Benchmark`, `GoalProjection` via `GoalTrack`)
pull in `recharts`. Visiting `/` currently ships every page's code and the charting library in one
bundle, even though the dashboard itself renders no charts. Purely a first-paint cost for a
single-user app on presumably a normal connection — not a resource-waste problem in the way the
other findings are.

**Fix idea:** convert route imports in `App.tsx` to `React.lazy(() => import(...))` wrapped in a
`<Suspense>` boundary, so chart-heavy pages only load when actually visited.

## Checked and found to be fine (no finding)

- `updateCash`/`updateSymbolMetadata` — these write on explicit user save actions (typing a new
  value, editing metadata), not on every page load, so they don't carry the load-amplification
  character of the `current_prices`/`net_worth_history` bugs even though they also don't diff
  before writing. Not worth its own fix on this basis alone.
- `useAutoRefreshPricesOnLoad.ts` — correctly one-shot via its ref guard; no re-fire issue.
- `RollingReturns.tsx`, `GoalProjection.tsx`, `Reports.tsx` — the expensive computations
  (`calculateXIRR`, `runGoalMonteCarlo`, chart series prep) are already correctly wrapped in
  `useMemo` with accurate dependency arrays.
- `fetch-historical-prices`/`fetch-benchmark-prices` upserts — low-frequency backfill/manual
  operations, not per-page-load writers; don't need the same diff-before-write treatment as
  `fetch-prices`.
- `portfolio-mcp-server/index.ts` — no expensive synchronous module-scope work at cold start.
- Every other page (`Index`, `Reports`, `GoalTrack`, `DeploymentPlan`, `DollarAdjustedReturns`,
  `Taxes`) calls its data hook exactly once — the double-fetch in finding #2 is isolated to
  `Charts`/`CorrelationHeatmap`.

## Suggested order, if picking one to start with

Purely a suggestion, not a decision made here: **#1 (`net_worth_history`)** is the closest analog
to the bug just fixed and the only one flagged above Low severity — reasonable to pair with it if
more of this category gets tackled. The rest are independent and can be picked in any order or
skipped entirely; none are urgent at this app's current scale.
