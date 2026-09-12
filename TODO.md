# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## Backlog

- [ ] **Scaling & archival plan.** Implement the plan in
      [docs/scaling-and-archival-plan.md](docs/scaling-and-archival-plan.md) — currently
      planning-only, nothing built yet. Needs the "Open decisions" in that doc answered first:
      retention window for `audit_logs`, where the archive lives (same-DB `_archive` table vs.
      Supabase Storage export), whether `pg_cron` is available/acceptable vs. a scheduled edge
      function, and `ai_rate_limits`' cleanup cadence.

## Performance

Priority recommendations from a performance review of the repo (2026-09-11).

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

## Portfolio AI / MCP tools

- [ ] Time series forecasting
- [ ] **Set up OpenRouter Guardrails** for the opt-in Nemotron/MiniMax path —
      [openrouter.ai/activity/guardrails](https://openrouter.ai/activity/guardrails) offers content
      filters, spending limits, and usage policies on top of an OpenRouter account/API key.
      Flagged by the user 2026-08-30 while testing the opt-in path
      ([docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md)). Not yet scoped — need
      to check at implementation time exactly what "spending limits" means for a *free-tier-only*
      usage pattern (this app never sends paid requests to OpenRouter today), whether policies are
      configured per-key or account-wide, and whether enabling anything here changes the existing
      `llm_quota_usage`-based quota tracking or is purely additive/defense-in-depth on top of it.

<details>
<summary>Archive (completed)</summary>

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

</details>
