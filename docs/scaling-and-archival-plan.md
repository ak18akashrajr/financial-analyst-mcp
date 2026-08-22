# Scaling & Archival Plan

**Status:** planning only — nothing in this doc is implemented yet. Written 2026-08-22, prompted
by adding the `audit_logs` table (see [security-review.md](security-review.md#2026-08-22---added-4-persistent-audit-trail-for-mcp-tool-calls))
and the obvious follow-up question: what happens to every append-only table in this app after a
decade of daily use, and how do we keep the old data without letting it slow the app down.

This is a planning doc to work from later, not a task list to execute now — see the "Open
decisions" section at the bottom for what needs to be picked before any of this gets built.

## The core tension

Two goals in tension:
1. **Nothing gets deleted.** Every transaction, price point, and tool-call record is either
   financial history or a security/audit trail — both are things you'd regret losing.
2. **The hot path doesn't slow down as the "everything" pile grows.** A decade of daily use is a
   real number of rows for some of these tables, not a hypothetical.

The resolution is the standard one: **keep a bounded "hot" working set for anything the app
queries in the normal course of use, and move everything else to a cheaper, still-durable
"archive" location that isn't in the query path.** Nothing is ever deleted outright — rows move,
they don't disappear.

## Growth model: every table, decade-scale estimate

| Table | Growth driver | ~10-year row estimate | Category |
|---|---|---|---|
| `ai_rate_limits` | one row per active 60s window, per request | up to ~5.5M (worst case: request every window, every day) | **Unbounded operational — no long-term value** |
| `audit_logs` | one row per MCP tool call | tens of thousands to a few hundred thousand (bounded by how much you actually use `/portfolio-ai`) | **Unbounded, but has long-term value (security/audit)** |
| `historical_prices` | trading days × tracked symbols | ~250 days/yr × symbol count (dozens) → low hundreds of thousands | **Bounded by market calendar + symbol count** |
| `benchmark_history` | trading days × benchmarks tracked (currently just NIFTY50) | ~2,500 | Bounded, small |
| `fx_rates` | days × currency pairs | low thousands | Bounded, small |
| `net_worth_history` | one snapshot per day (at most) | ~3,650 | Bounded, small |
| `period_reports` | one per reporting period (monthly, per [periodReports.ts](../src/lib/periodReports.ts)) | ~120 | Bounded, trivial |
| `transactions` | user-driven (buys/sells) | hundreds to low thousands, realistically | Bounded, small |
| `goals`, `goal_allocations`, `cash_settings`, `current_prices`, `symbol_metadata`, `market_indicators`, `ticker_fundamentals` | config/lookup, not time-series | dozens to low hundreds | Bounded, trivial |

**Two tables actually matter here: `ai_rate_limits` and `audit_logs`.** Everything else is
small enough over a decade that Postgres (and Supabase's free/pro tiers) won't notice — no plan
needed for those beyond "keep doing what we're doing." `historical_prices` is the next one to
watch if the tracked-symbol count grows a lot, but it's an order of magnitude smaller than the two
above even in that case.

## What actually gets slow, and why

Row count alone isn't the risk — Postgres handles millions of rows fine with the right indexes.
The real risks are specific and checkable:

1. **`ai_rate_limits` has no pruning at all today.** [`_shared/rate-limit.ts`](../supabase/functions/_shared/rate-limit.ts)
   inserts a new `(user_id, window_start)` row every minute a request happens and never deletes
   old ones. Every row becomes worthless the moment its 60-second window closes — nothing ever
   reads an old window again — so this table grows forever for zero ongoing benefit. This is the
   single biggest and easiest-to-fix growth risk in the app, and it's not a hard problem: it's
   pure janitorial cleanup, no archival needed (see "Not everything needs an archive," below).

2. **`audit_logs` has an index on `called_at desc` but no retention policy.** Fine at thousands of
   rows; at hundreds of thousands, `select * from audit_logs order by called_at desc limit 50` (or
   whatever an eventual admin/debug view does) stays fast because of the index, but the table's
   on-disk size, autovacuum time, and backup/export size all grow without bound. This is exactly
   the kind of table that wants the hot/archive split.

3. **The frontend fetches full tables, not bounded ranges, for anything it needs client-side.**
   [`usePortfolio.ts:23`](../src/hooks/usePortfolio.ts) does
   `supabase.from('transactions').select('*').order('date', ...)` — every transaction, every load,
   full stop. [`Reports.tsx:142`](../src/pages/Reports.tsx) does the same for `net_worth_history`.
   This is fine today (both tables are small — see the table above) but it means every pure
   client-side calculation in [`src/lib/`](../src/lib/) (`xirr.ts`, `taxCalculator.ts`,
   `periodReports.ts`, FIFO cost-basis lot matching, etc.) runs over the *entire* transaction
   history on every page load, in the browser, not the database. A decade of active trading (say,
   thousands of transactions) is still fast in JS, but this is the pattern to watch if the
   transaction table ever grows an order of magnitude larger than expected — the fix there is
   date-bounding the query or pushing the computation server-side, not touching the DB schema.

4. **The MCP tool layer is already bounded correctly** — worth noting as a contrast, not a
   problem. Every time-series read in [`_shared/portfolio-data.ts`](../supabase/functions/_shared/portfolio-data.ts)
   (`fetchDailyReturns`, `getRiskMetrics`, `compareToBenchmark`) already does
   `.order(...).limit(lookbackDays + 1)` — bounded lookback windows, not full-table scans. This
   pattern is the one to replicate wherever new time-series reads get added later, including any
   archive-query path this plan eventually produces.

## Not everything needs an archive

Worth stating explicitly, since the instinct is "growing table → go build an archive": a table
only needs an archive if the old rows have value once they leave the hot path. `ai_rate_limits`
doesn't — a rate-limit window from a year ago has no forensic, financial, or audit value. That one
just needs a **delete**, not a **move**. `audit_logs` and the market-data tables do have lasting
value (a security trail, and historical prices for point-in-time XIRR/reports), so those are the
ones that need an actual archive rather than a cleanup job.

## Remediation options, per category

### Category A — operational, no long-term value (`ai_rate_limits`)

**Fix: scheduled delete, no archive.** Options, roughly in order of how much new infrastructure
they need:

- **A Postgres `pg_cron` job** (`delete from ai_rate_limits where window_start < now() - interval '1 hour'`)
  running hourly — needs the `pg_cron` extension enabled on the Supabase project (not currently
  enabled anywhere in this repo's migrations). Simplest, DB-native, no edge function involved.
- **A scheduled edge function** (Supabase's own cron-trigger support, or an external scheduler
  hitting a new `cleanup-rate-limits` function) doing the same delete. More moving parts than
  `pg_cron`, but keeps all "logic" in TypeScript alongside the rest of the app instead of splitting
  it across SQL and edge functions — consistent with this repo's general preference (see
  [portfolio-mcp-server](../supabase/functions/portfolio-mcp-server)'s own header comment about
  avoiding split logic where avoidable).
- **Do it lazily inside `checkRateLimit()` itself** — e.g., a cheap `delete ... where window_start <
  now() - interval '1 hour' and random() < 0.01` fired occasionally as a side effect of a real
  request, no scheduler needed at all. Zero new infrastructure, but couples cleanup to traffic
  (a long period of no requests means no cleanup either — acceptable here, since no requests also
  means no new rows).

### Category B — has long-term value (`audit_logs`, and eventually `historical_prices`/`benchmark_history`/`fx_rates` if they ever grow enough to matter)

**Fix: hot/archive split**, one of:

- **Time-based partitioning** (Postgres declarative `PARTITION BY RANGE (called_at)`, monthly or
  yearly). Old partitions can be detached cheaply (no row-by-row `DELETE` + `VACUUM`) and either
  kept attached-but-untouched (Postgres skips them via partition pruning on any date-bounded query)
  or physically moved to cold storage. This is the standard answer for exactly this shape of
  problem, but requires recreating `audit_logs` as a partitioned table (a real migration, not just
  an `ALTER TABLE` — Postgres can't convert an existing plain table to partitioned in place).
- **A separate `_archive` table + a periodic move job** (`insert into audit_logs_archive select *
  from audit_logs where called_at < cutoff; delete from audit_logs where called_at < cutoff;`,
  done in a transaction, on the same `pg_cron`/scheduled-function options as Category A). Simpler
  to reason about than partitioning, doesn't require recreating the table, but the move itself is
  a real write-heavy operation each time it runs — fine at this app's scale, less fine if it were
  ever moving millions of rows in one pass (not expected here).
- **Export-and-delete to Supabase Storage** — periodically dump rows older than the cutoff to a
  compressed JSON/CSV file in a Storage bucket, then delete from the table. Cheapest storage cost
  for genuinely cold data (a decade-old audit trail you'll realistically never query), but loses
  SQL queryability — recovering it means downloading and re-importing the file, not `SELECT`.
  Best suited for data you want to *keep* but don't expect to ever *query* again.

**Recommendation to evaluate later (not a decision made here):** the `_archive` table approach for
`audit_logs` first — it's the smallest change, keeps the data SQL-queryable if you ever do want to
look something up, and this app's realistic row counts (tens to low hundreds of thousands) don't
need partitioning's extra complexity yet. Revisit if `audit_logs` ever crosses roughly a million
rows or the move job's runtime becomes noticeable.

### Category C — client-side full-table reads (`transactions`, `net_worth_history` in the frontend)

**Fix, if this ever becomes a real problem (it isn't yet — see the growth table above):**

- Date-bound the query (e.g. `usePortfolio.ts` fetching only the current + prior fiscal year by
  default, with an explicit "load full history" action for the tax/reports pages that genuinely
  need everything).
- Or precompute summaries server-side (a materialized view or a scheduled snapshot table) for the
  dashboards that only need aggregates, reserving the full per-transaction fetch for the pages that
  need lot-level detail (tax harvesting, FIFO cost basis).

Not recommending either yet — flagging them so the option is documented before they're needed,
not after the app is visibly slow.

## Open decisions (needed before implementation)

These are genuinely the user's call, not something to default silently:

1. **Retention window for `audit_logs`** before rows move to archive/cold storage — 90 days? A
   year? Longer, since it's a security trail and storage is cheap at this scale?
2. **Where the archive lives** — a same-database `audit_logs_archive` table (queryable, simplest),
   or an export to Supabase Storage (cheapest, not queryable without re-importing)?
3. **Whether `pg_cron` is available/acceptable** on the current Supabase plan, vs. preferring a
   scheduled edge function so the cleanup logic stays in TypeScript alongside everything else.
4. **`ai_rate_limits`' cleanup cadence** — hourly cron, or the lazy random-delete-on-request
   approach — mostly a matter of taste since either fully solves the unbounded-growth problem.

None of these block anything today; they're the actual first questions to answer once this work
starts.

## Explicitly out of scope for now

- Partitioning any table before it's actually large enough to need it — premature for every table
  in the growth-model table above except possibly `audit_logs` down the line.
- Any change to `historical_prices`/`benchmark_history`/`fx_rates` — their growth is small and
  bounded by the market calendar; revisit only if the tracked-symbol count grows dramatically.
- Any change to the MCP tool read patterns in `_shared/portfolio-data.ts` — already correctly
  bounded (see point 4 above); nothing to fix there.
