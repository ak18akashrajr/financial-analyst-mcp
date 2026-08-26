# TODO / Action Items

Running list of action items for this repo. Add new items to the bottom of the relevant section;
check items off (`- [x]`) when merged, and note the PR number.

## Dashboard / Benchmark (HIGH PRIORITY)

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

## Portfolio AI / MCP tools

- [ ] Overlap % MCP agent tool to be added
- [ ] All risk ratios to be added
- [x] Async / bounded concurrency — [PR #TBD](https://github.com/ak18akashrajr/financial-analyst-mcp/pulls):
      `portfolio-ai`'s tool-call loop now runs a turn's independent tool calls concurrently
      (bounded by `MAX_CONCURRENT_TOOL_CALLS = 3`) via a new
      [`mapWithConcurrency`](supabase/functions/_shared/concurrency.ts) helper, instead of
      awaiting them one at a time.
- [ ] Retries with backoff
- [ ] Time series forecasting
- [ ] Evaluate OpenRouter + Nemotron plan — see
      [docs/openrouter-nemotron-plan.md](docs/openrouter-nemotron-plan.md)
