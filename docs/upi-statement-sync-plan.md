# UPI cash-sync (Phase 1: manual statement upload) — implementation plan

Scope, as agreed in [feature-ideas.md](feature-ideas.md#0-auto-sync-cash-balances-from-upi-transactions-priority):
- Keeps **Operating Cash** (`liquidCash`) and **Cash Reserve** (`vaultCash`) in sync. `pfBalance`
  is explicitly out of scope.
- Data source is a **manually uploaded bank statement export (CSV/XLS)** — no external API, no
  credentials handled by the app. Vault and Operating Cash are held at two *different* banks, so
  this needs two statement formats supported, not one (see §2).
- Parsed rows land in a **review queue** as "pending." Nothing touches the real balance until you
  approve a row.
- Approved rows become **auditable ledger entries**, not a raw overwrite of `cash_settings`. The
  displayed balance becomes a derived total (opening balance + approved ledger entries), the same
  way `transactions` already drives holdings rather than a hand-edited number.
- **Phase 2 (Gmail alert parsing) is explicitly out of scope for this plan** — queued separately in
  the backlog, only after this phase has been used for a while.

---

## 1. Data model

New table `bank_statement_transactions` (migration `supabase/migrations/<ts>_bank_statement_transactions.sql`),
modeled on the existing `transactions` table's shape/RLS pattern
([supabase/migrations/20260327054339_...sql:2-10](../supabase/migrations/20260327054339_167398df-fe72-42ee-b1d0-fc458ca5677e.sql)):

```sql
CREATE TABLE public.bank_statement_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account TEXT NOT NULL CHECK (account IN ('liquid', 'vault')),
  txn_date TIMESTAMP WITH TIME ZONE NOT NULL,
  description TEXT NOT NULL,          -- raw narration from the statement, for audit/dedup
  amount NUMERIC NOT NULL,            -- signed: positive = credit, negative = debit
  reference TEXT,                     -- UPI ref / cheque no / UTR if present, used for dedup
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  import_batch_id UUID NOT NULL,      -- groups rows from one upload, for a per-upload undo
  source_row_hash TEXT NOT NULL,      -- hash(account, txn_date, description, amount, reference) — dedup key
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX bank_statement_transactions_dedup
  ON public.bank_statement_transactions (source_row_hash);

ALTER TABLE public.bank_statement_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users only on bank_statement_transactions"
  ON public.bank_statement_transactions
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
```

Notes:
- `amount` is signed (unlike `transactions.quantity`/`price`, which are `CHECK > 0` because BUY/SELL
  already carries direction) — a bank ledger needs both debits and credits, so a `CHECK` forbidding
  zero (`amount <> 0`) is the right constraint here, not `> 0`.
- `source_row_hash` + the unique index is the re-upload safety net: re-uploading the same statement
  (or an overlapping date range from a fresh export) silently no-ops on duplicate rows via
  `upsert(..., { onConflict: 'source_row_hash', ignoreDuplicates: true })` instead of double-counting.
- `import_batch_id` lets the review UI show "12 new transactions from statement uploaded just now"
  and lets a whole bad upload be discarded in one action.
- `cash_settings.liquid_cash` / `vault_cash` stop being the hand-edited source of truth for these
  two fields once this ships. Simplest correct approach: keep them as an **opening balance
  checkpoint** (still hand-editable for the one-time initial baseline or a manual correction), and
  compute the displayed balance as `opening + sum(approved ledger amounts since checkpoint)`. This
  avoids a bigger migration (moving to a full running-ledger model) while still giving an auditable
  trail for everything that flows through the upload path.

## 2. Statement parsing

Vault and Operating Cash are held at two different banks — their netbanking exports will almost
certainly differ in column layout, date format, and header/footer boilerplate. This plan treats
that as two parser variants behind one interface, not one parser with a bank name hardcoded into
it, so the docs/code stay bank-agnostic and adding a third account later is just a third variant.

- New dependency: `papaparse` for CSV (small, no XLS support). XLS/XLSX support (`xlsx` or
  `exceljs`) only gets added if one of the two exports actually comes as XLS — confirm this per
  account before picking the dependency, don't build for both blind.
- New pure module `src/lib/bankStatementParser.ts`:
  - `parseBankStatement(fileText: string, account: 'liquid' | 'vault'): ParsedRow[]` — dispatches
    to a per-account parsing function internally (e.g. `parseVaultAccountStatement` /
    `parseOperatingAccountStatement`) once both real formats are known, normalizing whatever the
    quirks are (boilerplate rows, "Sr No" columns, DD/MM/YYYY dates, separate Debit/Credit columns
    vs. a signed amount) into one common `{ txnDate, description, amount, reference }[]` shape.
  - Kept as a pure function (no Supabase import) specifically so it's unit-testable per the repo's
    existing convention of testing pure `src/lib/*.ts` functions directly (`xirr.ts`,
    `taxCalculator.ts` etc. all follow this shape) — this is the one piece of new logic that can be
    tested the same way the rest of the codebase already tests things, sidestepping the "no
    Supabase-mocking template exists yet" gap noted below.
  - Validate with `zod` (already a dependency) — reject and surface a clear error on any row that
    doesn't match the expected shape, rather than silently skipping or guessing.

## 3. Backend/hook layer

Extend `src/hooks/usePortfolio.ts` (matching its existing plain-state + `useCallback` convention,
no react-query):

- `pendingBankTransactions` state, loaded alongside the existing `Promise.all` fetch on mount
  (same spot as the current `cash_settings`/`transactions` parallel load).
- `importBankStatement(account, parsedRows)` — `supabase.from('bank_statement_transactions').upsert(rows, { onConflict: 'source_row_hash', ignoreDuplicates: true }).select()`, then update local state; follow the existing `if (error) { toast.error(...); console.error(error); return; }` convention, no throw.
- `approveBankTransaction(id)` / `rejectBankTransaction(id)` — status update + `reviewed_at`; on
  approve, recompute the derived `liquidCash`/`vaultCash` the same way `addTransaction` currently
  calls `recordNetWorthSnapshot()` after a write (`usePortfolio.ts:106-130`) — approving a row
  should similarly trigger a `recordNetWorthSnapshot()` refresh so net worth history stays correct.
- `approveAllInBatch(importBatchId)` for the "approve all 12" bulk action.
- Reuse the exact camelCase↔snake_case manual mapping style already used for `cash_settings` and
  `transactions` (no shared mapper exists in this codebase — introducing one now is out of scope
  for this feature, stay consistent with existing duplication rather than refactoring it in passing).

## 4. UI

- New page `src/pages/BankSync.tsx` (or a new section on the existing Cash page — your call at
  build time), added as one more `<Route>` inside the existing `<ProtectedRoute>` block in
  [App.tsx:39-51](../src/App.tsx), plus a nav entry.
- Upload widget: plain `<input type="file" accept=".csv">` (no existing dropzone component in the
  repo to reuse — this is new UI) — select which account (liquid/vault) the file is for, parse
  client-side with `bankStatementParser.ts`, show a preview before calling `importBankStatement`.
- Review queue: table of pending rows grouped by `import_batch_id`, each with approve/reject, plus
  "approve all" per batch. Approved/rejected rows drop out of the pending view but stay in the
  table for audit (status column).
- `CashSection.tsx`'s "Operating Cash" / "Cash Reserve" cards keep working as-is, but the value
  becomes `opening (cash_settings) + sum(approved ledger rows)` instead of the raw
  `cash_settings.liquid_cash`/`vault_cash` field — computed once in `usePortfolio.ts`, not in the
  component.

## 5. Tests

- `src/test/bank-statement-parser.test.ts` — pure function tests over `bankStatementParser.ts`,
  with fixtures for *both* accounts' real export formats once known (normal rows, a debit row, a
  credit row, a malformed row that should throw/reject, for each). This is the highest-value test
  here and fits the existing pure-lib test pattern exactly.
- `src/test/bank-sync-page.test.tsx` — component test mocking `usePortfolio` directly (per the
  established `vi.mock('@/hooks/usePortfolio', ...)`-style pattern used for
  `protected-route.test.tsx` / `exposure-section.test.tsx`), not the Supabase client — asserts
  approve/reject/bulk-approve wire up to the right hook calls.
- No existing template in this repo tests a hook that talks to Supabase directly (`usePortfolio.ts`
  itself has zero test coverage today) — this plan does not attempt to introduce that pattern
  retroactively; the new hook functions get exercised indirectly through the component test above,
  consistent with the current gap rather than trying to fix it as a side effect of this feature.

## 6. Sequencing / effort

1. Migration + RLS policy (small, mechanical).
2. `bankStatementParser.ts` + its tests (medium — the real per-bank CSV quirks are the unknown
   here, for *both* accounts since they're different banks; **needs real sample exports from you
   to build against**, synthetic fixtures risk not matching either real format).
3. `usePortfolio.ts` extensions (small–medium, follows existing conventions closely).
4. Upload + review queue UI (medium — genuinely new UI, no prior art to lean on).
5. Wire `CashSection.tsx` display to the derived balance (small).

**Total: medium** — no single step is large, but step 2 has a real external dependency (actual
statement files to build the parser against, for two different banks) that blocks accurate scoping
of its own effort until those arrive.

## Status / handoff notes

Keep this section updated as the source of truth for "where we left off" across sessions/machines
— check here first when resuming.

- **Confirmed:** Vault and Operating Cash are two separate accounts at two different banks (exact
  bank names intentionally omitted from this doc since it's pushed to GitHub — Claude has them
  noted privately and doesn't need reminding). Each needs its own statement export and its own
  parser variant per §2.
- **Waiting on (blocks starting implementation):**
  - A real (redact account numbers/personal identifiers if you like) statement export for the
    Vault account.
  - A real statement export for the Operating Cash account.
  - Confirmation of CSV vs XLS for each — they may differ from each other.
- **Once exports are shared, next step is:** inspect both formats together, finalize the exact
  `ParsedRow` normalization for each, then start on step 1 (migration) while the parser is being
  built against real fixtures — those two can happen in parallel.
- **Nothing has been implemented yet** — no migration, no `bankStatementParser.ts`, no UI exist as
  of this doc's last edit. Everything above is plan only.
