# Dashboard XIRR breakdown

The dashboard's XIRR stat ([SummaryBar.tsx](../src/components/SummaryBar.tsx)) is click-to-expand
via [XirrDetailsCard.tsx](../src/components/XirrDetailsCard.tsx), showing four numbers: Overall
Portfolio XIRR, Portfolio XIRR (ex-PF holdings), and the same-cash-flows XIRR against NIFTY 500 and
S&P 500. This doc records what each one actually means and why, since none of it is obvious from
the UI alone.

## Why PF was never in the calculation

The original ask assumed the dashboard's single XIRR figure blended in the PF (PPF/EPF) balance
from Cash Management. It doesn't, and structurally can't: `cash_settings.pf_balance` is a manually
edited running total with no dated contribution history — no record of *when* money went in or how
much at each point. XIRR is a function of dated cash flows; there simply aren't any for PF to feed
it. [usePortfolio.ts](../src/hooks/usePortfolio.ts)'s `xirr` has only ever been built from the
`transactions` table (real BUY/SELL rows) plus current holdings value — i.e. it already was
"Portfolio XIRR" as originally requested, not "Overall including PF."

## Overall Portfolio XIRR vs. Portfolio XIRR (ex-PF holdings)

- **Overall Portfolio XIRR** (`summary.xirr`) — every transaction, unfiltered.
- **Portfolio XIRR (ex-PF holdings)** (`summary.xirrExPf`) — the same calculation, excluding any
  symbol whose `symbol_metadata.category` is `'PPF / EPF'`. This category is a real, selectable
  option in the Holdings table ([HoldingsTable.tsx](../src/components/HoldingsTable.tsx)) — distinct
  from the manual PF balance field — for the case where an actual traded instrument (e.g. an EPF
  passbook tracked as a NAV-style holding) is entered as real transactions.

As of this writing, no holding is tagged `PPF / EPF`, so the two numbers are identical — confirmed
by the user during scoping. `xirrExPf` is computed independently rather than hardcoded equal to
`xirr`, so the two automatically diverge the moment such a holding is added, instead of silently
staying wrong.

Neither number includes the manual PF balance, for the reason above.

## Benchmark XIRR (NIFTY 500 / S&P 500)

Computed by [`computeBenchmarkXirr`](../src/lib/benchmarkXirr.ts): replay every real transaction as
a buy/sell of the benchmark index on the exact same date, for the exact same ₹ amount, tracking a
running index-unit ledger; value the remaining units at the latest available close as the terminal
cash flow; solve XIRR on that synthetic series with the same engine ([xirr.ts](../src/lib/xirr.ts))
used for the real portfolio. This is the standard "what if this same money had gone into the index
instead" comparison (the same approach Kuvera/Zerodha Console use for benchmark XIRR) — not a naive
index CAGR over the holding period, which would ignore the timing/sizing of contributions and so
wouldn't be a fair comparison against a real, irregularly-funded portfolio.

**Data coverage.** `benchmark_history` (populated by the
[fetch-benchmark-prices](../supabase/functions/fetch-benchmark-prices/index.ts) edge function) is
only backfilled on demand — see the Benchmark page's manual "Backfill" button. If the stored
history for a symbol doesn't reach back to your earliest transaction date,
`XirrDetailsCard` automatically requests `range: 'max'` from that function before computing, so the
number is as complete as Yahoo Finance's own history allows. Any transaction still older than what
comes back (rare — mainly a limitation of how far back Yahoo serves daily closes for that index) is
excluded from that benchmark's replay, and the popover states exactly how many transactions were
excluded and the earliest available date, rather than silently dropping them into an unstated
approximation.

**Terminal-flow edge case.** If replaying SELLs against the running index-unit ledger ever drives
the unit count to zero or below (i.e. the real portfolio's actual sells, mapped through the index's
price history, "sold" more index-equivalent value than had accumulated), no terminal cash flow is
added for that benchmark — mirroring how the real `xirr` calculation only appends a terminal flow
when `currentValue > 0`. `calculateXIRR` then either returns a rate from the historical flows alone
or `null` if the resulting cash-flow series can't converge to a sane rate; either way, no
fabricated number is shown.

## Why this contradicts the `/benchmark` page, and why that's fine

[Benchmark.tsx](../src/pages/Benchmark.tsx) computes a *different* metric over a *different* scope:
`(last snapshot ÷ first snapshot − 1)` on `net_worth_history`/`benchmark_history`, independently per
series, restricted to a selected 30/90/180/365-day window, and explicitly holdings-value-only
(excludes cash, PF and liabilities). This dashboard breakdown instead replays the full transaction
history as dated cash flows and solves XIRR. Different methodology (windowed simple return vs.
whole-history cash-flow XIRR) plus a different window means the two pages will disagree for the same
symbol — e.g. NIFTY 500 showing one figure here and a different one on `/benchmark` — and that's
expected, not a bug. Both surfaces now say so on-screen (`XirrDetailsCard`'s benchmark caveat here,
and the `InfoHint` caveat on `/benchmark`'s header) rather than leaving the reader to notice the
mismatch and wonder. See TODO.md's now-closed "Reconcile dashboard XIRR-breakdown benchmark numbers"
item for the decision history — labeling was chosen over unifying the two metrics, since they answer
genuinely different questions ("what if this money had gone into the index, timed exactly as
invested" vs. "how has my holdings' value tracked the index lately").
