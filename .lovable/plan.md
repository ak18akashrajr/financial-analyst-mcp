# Dollar-Adjusted Returns

## Why this matters
Your portfolio is measured in INR. If the rupee weakens against the dollar, an INR gain can still be a loss in global purchasing-power terms. This feature restates AUM, capital deployed and alpha in USD, so you can see how much of your return is real and how much is currency drift.

## What gets built

### 1. Homepage overview card (above Cash Management)
A single clickable section on `/` showing:
- AUM in USD (current value / today's USD-INR rate)
- Principal Capital Allocated in USD (each buy converted at the FX rate on its transaction date)
- USD return % vs INR return % side by side
- "Currency drag/tailwind" = INR return % − USD return %
- Small footer line: live rate, as-of timestamp, and the source it came from (e.g. "USDINR=X · Yahoo Finance · 01 Aug 2026 06:15")
Clicking the card routes to `/dollar-adjusted-returns`.

### 2. New page `/dollar-adjusted-returns`
- **KPI strip**: AUM (INR vs USD), invested (INR vs USD), absolute alpha in both, INR XIRR vs USD XIRR.
- **Dual-axis chart**: portfolio value in INR vs USD over time (uses existing `net_worth_history` snapshots joined to the FX series for the same dates).
- **USD-INR rate chart**: 1Y/3Y/5Y/Max toggle from stored daily rates.
- **Return attribution bar**: total USD return split into "asset return" and "currency effect".
- **Per-holding table**: symbol, INR return %, USD return % (buys converted at their trade-date rate), currency impact.
- **Data provenance panel**: which source each rate came from, count of rows per source, last refresh, and a "Refresh FX" / "Backfill FX history" button.
- Click-to-audit popovers (reusing `AuditPopover`) on the KPIs, showing formula, the exact rates used and their dates.

### 3. FX data layer — free sources with fallback
New edge function `fetch-fx-rates` tries sources in order and records which one succeeded:
1. Yahoo Finance chart API `USDINR=X` (already used for prices; gives both live and long daily history, no key)
2. Frankfurter.app (ECB data, no key) — daily and time-series endpoints
3. open.er-api.com (free tier, no key) — latest rate only
4. Last stored rate in the database, flagged as `cached`

Every stored rate carries its `source`, so the UI never presents a number without saying where it came from. If all live sources fail, the UI shows a stale-data badge rather than silently using an old rate.

## Technical details

**New table `fx_rates`**: `date` (unique with currency pair), `pair` (default `USDINR`), `rate`, `source`, `fetched_at`, timestamps. Public read/write policies matching your existing tables, plus the required GRANTs.

**Edge function `supabase/functions/fetch-fx-rates/index.ts`**:
- Modes: `latest` (upsert today's rate) and `history` (range `1y|5y|max`, bulk upsert daily closes).
- Returns `{ rate, date, source, fallbackChain: [...] }` so the client can display provenance.
- CORS via `npm:@supabase/supabase-js@2/cors`.

**New `src/lib/fx.ts`**:
- `rateOn(date)` — nearest prior stored rate (weekend/holiday safe), returns `{ rate, source, effectiveDate }`.
- `usdCashflows(transactions, fxMap)` — converts each buy/sell at its trade-date rate.
- `usdXirr()` — reuses the existing `calculateXIRR` on USD cashflows.
- `currencyAttribution()` — asset return vs FX effect decomposition.

**New `src/hooks/useDollarReturns.ts`** — loads `fx_rates`, current prices and transactions from the existing portfolio hook, memoizes all USD metrics, exposes `refreshFx()` and `backfillFx()`.

**New files**: `src/pages/DollarAdjustedReturns.tsx`, `src/components/DollarReturnsCard.tsx`, `src/lib/fx.ts`, `src/hooks/useDollarReturns.ts`, `supabase/functions/fetch-fx-rates/index.ts`.
**Edited**: `src/App.tsx` (route), `src/components/SideNav.tsx` + `MobileTopNav.tsx` (nav entry, `DollarSign` icon), `src/pages/Index.tsx` (card placement above `CashSection`).

Styling follows the existing dark card system, IB-level labels ("USD-Denominated AUM", "Currency Translation Effect"), and privacy masking via `usePrivacy`.

## Accuracy guardrails
- No invented rates: any date without a stored rate falls back to the nearest prior rate and is labelled as such in the audit popover.
- USD XIRR is computed from actual converted cashflows, not by dividing INR XIRR by FX drift.
- If FX history is missing for older transactions, the page shows a "Backfill required" prompt instead of estimating.
