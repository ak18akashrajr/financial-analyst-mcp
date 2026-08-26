# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## Dashboard / Benchmark (HIGH PRIORITY)

_(none currently — see Archive at the bottom for resolved items)_

## Backlog

- [ ] **Wire A2UI into AI Agent frontend response.** Scope: purely how the `portfolio-ai` chat
      response *renders* on the frontend — reformat it to look visually good (structured
      components instead of raw markdown/prose), not a server-side protocol change. Research
      best practice for integrating [A2UI](https://a2ui.org/) client-side rendering before
      implementing (check whether it's a renderer library that consumes a JSON/schema payload,
      and whether that payload can be derived from the existing chat response shape or needs
      the response format changed).

- [x] **AUM target: ₹50L by March 2028, on the net-worth chart.**
      [NetWorthChart.tsx](src/components/NetWorthChart.tsx) — added the simpler static version
      (no projected pace-to-target line): a dashed `ReferenceLine` at ₹50L labeled
      "Goal: ₹50L (Mar 2028)", the Y-axis domain extended so the goal line is always visible even
      while AUM is well below it, and a "`X.X`% of ₹50L goal (Mar 2028)" line next to the chart
      heading, computed from the same `currentNetWorth` prop the chart already uses (holdings +
      cash − liabilities). Both the goal label and the % figure respect privacy-hide mode. Tests:
      [net-worth-chart-goal.test.tsx](src/test/net-worth-chart-goal.test.tsx).

- [ ] **XIRR → time-to-double.** Show next to every XIRR figure in
      [XirrDetailsCard.tsx](src/components/XirrDetailsCard.tsx)'s breakdown (Overall, ex-PF,
      per-benchmark) — Rule of 72 / `ln(2)/ln(1+xirr)` style calculation per figure.

## Portfolio AI / MCP tools

- [ ] Overlap % MCP agent tool to be added
- [ ] All risk ratios to be added
- [ ] Time series forecasting
- [ ] Evaluate OpenRouter + Nemotron plan — see
      [docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md)

## Archive (completed)

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
