/**
 * Register of design trade-offs the project has knowingly accepted, shown on the Dev Zone
 * "Trade-offs" tab. Each entry records WHAT is imperfect, WHY it was accepted, what you will actually
 * SEE (including any on-screen safeguard), and WHEN it would be worth revisiting — so a future reader
 * (or future you) doesn't have to rediscover the reasoning, and doesn't mistake a known limit for a bug.
 *
 * Add new entries at the END of the relevant area; never silently delete one — mark it resolved in
 * `revisitWhen` and keep the history instead.
 */
export type TradeOffArea = 'Snapshots (data source)' | 'Seasonality audit' | 'Reports movement card' | 'AI tools (edge functions)';

export interface AcceptedTradeOff {
  /** Stable slug — never reuse. */
  id: string;
  area: TradeOffArea;
  title: string;
  /** What is imperfect, stated plainly. */
  tradeOff: string;
  /** Why it was accepted instead of fixed. */
  whyAccepted: string;
  /** What the user will actually see, and any on-screen safeguard. */
  impact: string;
  /** The condition under which it becomes worth fixing, and roughly how. */
  revisitWhen: string;
  /** ISO date the trade-off was accepted. */
  acceptedOn: string;
  /** ISO date it was fixed. Set instead of deleting the entry, so the history and reasoning stay. */
  resolvedOn?: string;
  /** Where the behaviour lives. */
  source: string;
}

export const TRADE_OFF_AREAS: TradeOffArea[] = ['Snapshots (data source)', 'Seasonality audit', 'Reports movement card', 'AI tools (edge functions)'];

const ACCEPTED = '2026-10-01';

export const ACCEPTED_TRADE_OFFS: AcceptedTradeOff[] = [
  // ── Snapshots (data source) ──
  {
    id: 'snapshot-price-at-save-time',
    area: 'Snapshots (data source)',
    title: 'Holdings in a snapshot are valued at the price on the day you saved',
    tradeOff:
      'A net_worth_history row is written only when a balance or a trade is saved, and it values holdings at the stored price at that moment. A price refresh on its own writes nothing.',
    whyAccepted:
      'net_worth_history is the only dated record of balances (cash_settings holds just the current value). A scheduled snapshot job or a full historical re-valuation was out of scope for the movement audit.',
    impact:
      'A month-end holdings value can be stale relative to the true month-end market. The Seasonality % and its audit are exact for what is stored, so they always agree with each other, but they are not a true market-close return.',
    revisitWhen:
      'If you want true month-end marks: add a scheduled daily snapshot, or value holdings from historical_prices (as Reports already does).',
    acceptedOn: ACCEPTED,
    source: 'supabase/migrations/20260918110000_add_acid_portfolio_mutation_functions.sql · record_net_worth_snapshot',
  },
  {
    id: 'snapshot-unpriced-symbol-zero',
    area: 'Snapshots (data source)',
    title: 'A symbol with no stored price counts as ₹0 in a snapshot',
    tradeOff:
      'record_net_worth_snapshot joins current_prices, so a symbol with no price row contributes ₹0 to portfolio_value (same as the client-side calculation).',
    whyAccepted:
      'Changing it would alter every historical snapshot semantics and the live net-worth number; the existing behaviour is consistent across the app.',
    impact:
      'Buying such a symbol shows in Seasonality as "new money" plus an equal fake "price loss" in that month. Net worth total is unaffected. The audit warns by name — but the warning checks TODAY\'s stored prices, so a symbol priced since then will not be flagged for an older month.',
    revisitWhen:
      'If unpriced symbols become common: store the symbols (or a price-source flag) in the snapshot, or fall back to cost when no price exists.',
    acceptedOn: ACCEPTED,
    source: 'src/lib/netWorthMovement.ts · unpricedTradedSymbols',
  },
  {
    id: 'snapshot-no-carry-forward',
    area: 'Snapshots (data source)',
    title: 'A month with no snapshot has no cell, and neither does the month after it',
    tradeOff:
      'Seasonality compares a month with the previous month\'s last snapshot. If you saved nothing in a month, there is no snapshot to compare, so that cell and the next one stay empty.',
    whyAccepted:
      'This is the heatmap\'s long-standing behaviour. Carrying the last value forward would invent a number for a month where nothing was recorded.',
    impact:
      'Quiet months show "—" and cannot be audited. Months that do have a cell are fully auditable.',
    revisitWhen:
      'If quiet months are common: carry the last snapshot forward and label that cell "carried forward".',
    acceptedOn: ACCEPTED,
    source: 'src/lib/netWorthMovement.ts · buildMonthlyMovements',
  },

  // ── Seasonality audit ──
  {
    id: 'seasonality-trade-date-split',
    area: 'Seasonality audit',
    title: 'New money vs price movement is split using trade dates',
    tradeOff:
      'A snapshot does not record which trades it included. The audit counts trades whose date falls after the previous month\'s last snapshot and up to this month\'s last snapshot as "new money"; everything else in the holdings change is "price movement".',
    whyAccepted:
      'It is the same inclusion rule Reports uses to decide which trades are in a position, and it needs no schema change. The holdings TOTAL comes straight from the snapshots, so it is exact either way.',
    impact:
      'A trade entered with a back-dated (or future-dated) trade date can land in "price movement" instead of "new money". Total change and every balance line are unaffected.',
    revisitWhen:
      'If you often back-date trades: record the trade set or cost basis inside each snapshot, or split by when the trade was entered.',
    acceptedOn: ACCEPTED,
    source: 'src/lib/netWorthMovement.ts · tradeFlowBetween, buildMonthlyMovements',
  },
  {
    id: 'seasonality-stored-net-worth',
    area: 'Seasonality audit',
    title: 'The cell % uses the stored net_worth; mismatches are shown, not hidden',
    tradeOff:
      'The heatmap % is based on each snapshot\'s stored net_worth (unchanged from before). The audit rows are built from the snapshot\'s separate balances.',
    whyAccepted:
      'Keeping the stored value means no existing heatmap number changed. For every snapshot written by the app the two agree exactly.',
    impact:
      'If a stored net_worth ever disagrees with its own components, the difference appears as an amber "Unreconciled" row so the audit still ties to the cell %.',
    revisitWhen:
      'If an Unreconciled row ever appears: investigate that snapshot row (legacy or manually edited data).',
    acceptedOn: ACCEPTED,
    source: 'src/components/NetWorthBridgeTable.tsx · unreconciled row',
  },

  // ── Reports movement card ──
  {
    id: 'reports-period-end-boundary',
    area: 'Reports movement card',
    title: "Trades and prices dated on the first day of the next period counted in the earlier period's close",
    tradeOff:
      'Reports measured a completed period at 00:00 on its exclusive end date (e.g. Oct 1). Because a snapshot treats that date as a whole day, holdings and historical closes dated Oct 1 leaked into the Sep-30 quarter close (and the first day of a period leaked into its own opening point). Balance edits were never affected: they are compared by timestamp.',
    whyAccepted:
      'It was accepted at first because it sat behind the published AUM figures and their tests, and changing it moves those numbers. It has since been fixed deliberately in its own change.',
    impact:
      "Before the fix a quarter close could be overstated if you traded on the first day of the next quarter (e.g. 10 shares held at the quarter end plus a buy of 10 more on the next quarter's first day showed as 20 shares at that day's higher price). Now a period opens where the previous one closed (the last instant of the day before) and closes at its own last instant, so each day's trades and prices land in exactly one period. AUM, the YoY and period-over-period figures and the movement card all use this rule; historical AUM for affected periods can differ from what was shown before.",
    revisitWhen:
      "Resolved for the Reports page. The AI tools had their own version of the problem, fixed separately — see the 'AI tools' entries below. Note for next time: in production transactions.date is a full entry timestamp (not a bare date), so the page-level leak showed up mainly through historical closes dated on the boundary day.",
    acceptedOn: ACCEPTED,
    resolvedOn: '2026-10-01',
    source: 'src/lib/periodReports.ts · periodOpeningAsOf / periodClosingAsOf, src/pages/Reports.tsx',
  },
  {
    id: 'reports-no-opening-snapshot',
    area: 'Reports movement card',
    title: 'No snapshot at the opening date means opening balances are ₹0',
    tradeOff:
      'Cash, Vault, PF and Liabilities for a past date come from the latest snapshot at or before it. If none exists they are ₹0 — the app never blends today\'s balances into a past period.',
    whyAccepted:
      'Inventing an opening balance would be worse than showing none. This rule already governs the rest of the Reports page.',
    impact:
      'For a period starting before your first snapshot, the whole closing balance appears as "balance change". The card shows a warning, and percentages show "—" when opening net worth is ₹0.',
    revisitWhen:
      'If you want earlier periods: enter a baseline balance snapshot dated before them.',
    acceptedOn: ACCEPTED,
    source: 'src/lib/periodReports.ts · buildSnapshot, src/lib/netWorthMovement.ts · buildPeriodBridge caveats',
  },
  {
    id: 'reports-cost-marked-holdings',
    area: 'Reports movement card',
    title: 'Holdings with no historical price are valued at cost',
    tradeOff:
      'If a symbol has no historical close at or before a date, Reports marks it at average cost (existing rule).',
    whyAccepted:
      'The alternative is a fabricated mark-to-market. Valuing at cost never overstates gains.',
    impact:
      'That holding shows ₹0 price movement for the period, which understates it. The card lists a caveat with the count; the page-level banner offers a price backfill.',
    revisitWhen:
      'Run a price backfill for the symbol; no code change needed.',
    acceptedOn: ACCEPTED,
    source: 'src/lib/periodReports.ts · resolvePrice',
  },
  {
    id: 'reports-presentation-rounding-share',
    area: 'Reports movement card',
    title: 'Rupee rounding, and shares that exceed 100%',
    tradeOff:
      'Amounts are displayed rounded to the whole rupee, and "Share of change" is each row ÷ the total change.',
    whyAccepted:
      'Whole rupees match the rest of the app. Share is the natural "how much of the change was this" reading; it is only awkward when items offset each other.',
    impact:
      'Displayed rows can differ from the displayed total by ₹1 (the underlying maths is exact). When items offset — e.g. stocks −₹40,000 and Vault +₹60,000 — shares read −200% and 300%; use the "Pts of opening" column as the yardstick, which always sums to the total %.',
    revisitWhen:
      'Only if the ₹1 display difference starts to bother you: show paise in the audit popovers.',
    acceptedOn: ACCEPTED,
    source: 'src/components/NetWorthBridgeTable.tsx',
  },

  // ── AI tools (edge functions) ──
  {
    id: 'ai-tools-period-boundaries',
    area: 'AI tools (edge functions)',
    title: "Period and as-of valuations compared timestamps against bare dates and midnight UTC",
    tradeOff:
      "get_period_performance, get_portfolio_value_as_of and get_exposure_drift compared transactions.date (a full entry timestamp in production, because add_transaction_and_snapshot lets the column default fill it) against bare YYYY-MM-DD strings, and compared net_worth_history.recorded_at against a bare date, which Postgres reads as 00:00 UTC (05:30 IST). The period start was also inclusive.",
    whyAccepted:
      "Not accepted — fixed. Recorded here so the reasoning and the before/after behaviour are not lost.",
    impact:
      "Before: every trade made on a period's last day was missing from its closing holdings; the whole last day's balance edits (and, for an in-progress period, today's own edits) were missing from closing cash; and a bare-dated first-day trade counted in both the opening holdings and the period's activity, understating market appreciation. Now: trades are placed by their IST calendar day, a period opens at the end of the previous day (so it opens where the previous one closed), and cash is read up to the end of the IST day (up to now for an in-progress period). The same rule applies to the as-of valuation tools, so those figures can differ from what the AI quoted before.",
    revisitWhen:
      "Resolved. Deploy the edge functions for it to take effect: npx supabase@1.190.0 functions deploy --use-api.",
    acceptedOn: ACCEPTED,
    resolvedOn: '2026-10-01',
    source: 'supabase/functions/_shared/portfolio-data.ts · txnDayIst, endOfIstDay, getPeriodPerformance',
  },
  {
    id: 'ai-tools-list-transactions-range',
    area: 'AI tools (edge functions)',
    title: "list_transactions compared dates as plain strings",
    tradeOff:
      "listTransactions filtered t.date >= startDate && t.date <= endDate on the raw string. With timestamped trades, any trade made on the end date itself was excluded from the range.",
    whyAccepted:
      "Not accepted — fixed in the same change as the period boundaries, once it was clear it was the same defect. It is kept apart from the period entry because it is a different tool with its own callers.",
    impact:
      "Before: asking the AI for transactions between two dates could miss trades made on the end date. Now the range is inclusive on IST calendar days at both ends; the returned date strings are unchanged.",
    revisitWhen:
      "Resolved. Deploy the edge functions for it to take effect.",
    acceptedOn: ACCEPTED,
    resolvedOn: '2026-10-01',
    source: 'supabase/functions/_shared/portfolio-data.ts · listTransactions',
  },
];
