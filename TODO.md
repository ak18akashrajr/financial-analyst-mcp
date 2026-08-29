# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## High Priority Action Items

Flagged 2026-08-28 during a Reports-page (`/reports`) calculation audit requested by the user,
after confirming and fixing one instance of this bug class in
[fix/timezone-date-boundary-bug](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/new/fix/timezone-date-boundary-bug)
(`src/lib/periodReports.ts` + `src/pages/Reports.tsx`, using the new
[`parseLocalDate`](src/lib/dateUtils.ts) helper). Root cause: Postgres `DATE` columns
(`transactions.date`, `historical_prices.date`, `benchmark_history.date`, goal `target_date`) come
back as bare `'YYYY-MM-DD'` strings with no time/offset. `new Date(dateString)` parses those per the
ISO-8601 spec as **UTC midnight**, which is a different instant from the **local midnight** every
other point-in-time `Date` in this app is built with (`new Date(y, m, d)`, `new Date()`). In a
timezone ahead of UTC (verified under Asia/Calcutta, UTC+5:30) that skew silently drops or
misclassifies a row whose date exactly matches the comparison boundary.

**Confirmed bugs** — same root cause verified by reading the actual code, not fixed yet:

| File | What's wrong | Stakes |
|---|---|---|
| [`src/lib/taxCalculator.ts:141-143`](src/lib/taxCalculator.ts) | `holdingDays = today.getTime() − new Date(lot.date).getTime()`, then `isLongTerm = holdingDays > thresholdDays` (365/1095-day LTCG threshold). The UTC-vs-local skew can flip STCG↔LTCG classification for a lot sitting exactly at the threshold. | **Highest** — changes reported tax liability. |
| [`src/pages/RollingReturns.tsx:27-59`](src/pages/RollingReturns.tsx) (`computeWindowXIRR`) | Window `start`/`windowEnd` built locally; transaction and price dates parsed via bare `new Date(...)`, compared against them for inclusion and for "quantity at window start." | XIRR values on the Rolling Returns page. |
| [`src/lib/benchmarkXirr.ts:36-40`](src/lib/benchmarkXirr.ts) (`priceOnOrBefore`) | Same pattern for benchmark price lookups. | Benchmark comparison XIRR. |
| [`src/pages/GoalTrack.tsx:509,684`](src/pages/GoalTrack.tsx) | `goal.target_date` (DATE column) compared via `.getTime()` against `Date.now()`/local `today` for "days remaining." | Goal progress display only — lower stakes. |

**Traced 2026-08-28** — both of the previously-"inconclusive" spots, resolved:

- [x] **`src/lib/chartRange.ts:94-95` — cleared, not a bug.** Traced `computeRangeXIRR`'s only
      DATE-only-column caller (`PortfolioCharts.tsx`'s `dateKey='date'` usage): its chart points are
      keyed by `t.date.split('T')[0]` (the raw transaction date string, untouched), and the
      transactions compared against them are parsed via bare `new Date(t.date)` — both sides use
      the identical (UTC) parse of the identical kind of string, so the skew is applied uniformly
      to both sides and cancels out. `NetWorthChart.tsx`'s other call site uses `recorded_at`, a
      `timestamptz` column (a real instant, not a bare DATE) — also not affected. No fix needed.
- [x] **`src/components/PortfolioCharts.tsx:108` — confirmed and fixed**, in
      [fix/timezone-date-boundary-bug](https://github.com/ak18akashrajr/financial-analyst-mcp/pull/new/fix/timezone-date-boundary-bug).
      `new Date().toISOString().split('T')[0]` gave the *UTC* calendar date to decide "does the
      timeline already have a point for today," while every other point on that timeline is keyed
      by the transaction's own (locally-meant) date string — wrong for the ~5.5 hours after local
      midnight (00:00–05:29 IST), where the UTC date is still "yesterday." Fixed with a new
      [`todayLocalDateString`](src/lib/dateUtils.ts) helper (local calendar date, zero-padded to the
      same `'YYYY-MM-DD'` shape). Cosmetic-only impact (a stale/missing "as of now" chart point
      during that window, never a wrong money figure) — fixed anyway since it was low-effort once
      traced. Tests: [dateUtils.test.ts](src/test/dateUtils.test.ts).

**Still needs a decision from the user before starting** — the 4 confirmed bugs below all remain
unfixed: fix all four now (each on its own branch/tests, same rigor as the `periodReports.ts` fix),
or hold `taxCalculator.ts` back for a separate, more careful pass/review since it changes reported
tax numbers.

- [ ] Fix the `taxCalculator.ts` LTCG/STCG threshold day-count bug (see table above)
- [ ] Fix the `RollingReturns.tsx` window-boundary bug (see table above)
- [ ] Fix the `benchmarkXirr.ts` price-lookup bug (see table above)
- [ ] Fix the `GoalTrack.tsx` days-remaining bug (see table above)

## Backlog

- [ ] **Wire Claude Agent SDK into the codebase.** So that users with Claude Agent SDK support can
      get the most out of the application. Needs scoping before implementation — how this relates
      to the existing `portfolio-ai` agent loop / MCP-tools setup
      ([supabase/functions/portfolio-ai/](supabase/functions/portfolio-ai/index.ts),
      [_shared/mcp-client.ts](supabase/functions/_shared/mcp-client.ts)) is still an open question.

- [ ] **Groq 429 error-surfacing.** When the Groq provider hits a rate limit (429), surface that to
      the user distinctly instead of a generic failure — currently
      [`withRetry`](supabase/functions/_shared/retry.ts) retries transient 429/5xx/529s with
      backoff, but if all retries are exhausted the user-facing error doesn't call out "rate
      limited" specifically. From the user's own portfolio-AI accuracy-testing notes as still open.

- [ ] **Scaling & archival plan.** Implement the plan in
      [docs/scaling-and-archival-plan.md](docs/scaling-and-archival-plan.md) — currently
      planning-only, nothing built yet. Needs the "Open decisions" in that doc answered first:
      retention window for `audit_logs`, where the archive lives (same-DB `_archive` table vs.
      Supabase Storage export), whether `pg_cron` is available/acceptable vs. a scheduled edge
      function, and `ai_rate_limits`' cleanup cadence.

## Portfolio AI / MCP tools

- [ ] All risk ratios to be added
- [ ] Time series forecasting
- [ ] Evaluate OpenRouter + Nemotron plan — see
      [docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md)

<details>
<summary>Archive (completed)</summary>

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

</details>
