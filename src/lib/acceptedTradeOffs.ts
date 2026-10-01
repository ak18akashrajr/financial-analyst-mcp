/**
 * Register of design trade-offs the project has knowingly accepted, shown on the Dev Zone
 * "Trade-offs" tab. Each entry records WHAT is imperfect, WHY it was accepted, what you will actually
 * SEE (including any on-screen safeguard), and WHEN it would be worth revisiting — so a future reader
 * (or future you) doesn't have to rediscover the reasoning, and doesn't mistake a known limit for a bug.
 *
 * Add new entries at the END of the relevant area; never silently delete one — mark it resolved in
 * `revisitWhen` and keep the history instead.
 */
export type TradeOffArea = 'Snapshots (data source)' | 'Seasonality audit' | 'Reports movement card';

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
  /** Where the behaviour lives. */
  source: string;
}

export const TRADE_OFF_AREAS: TradeOffArea[] = ['Snapshots (data source)', 'Seasonality audit', 'Reports movement card'];

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
    title: 'Trades and prices dated on the first day of the next period count in the earlier period\'s close',
    tradeOff:
      'Reports values a completed period at 00:00 on the exclusive end date (e.g. Oct 1). Holdings and historical closes dated that day are therefore included in the Sep-30 quarter close, while a balance edit made later on Oct 1 is correctly excluded.',
    whyAccepted:
      'It is existing behaviour behind the AUM figures and their tests; changing it moves published numbers, so it was kept out of this change.',
    impact:
      'The movement card stays consistent with the AUM tile (it uses the same snapshots), and the next period opens from the same point, so nothing is double counted. The quarter close can be slightly overstated if you traded on the first day of the next quarter.',
    revisitWhen:
      'Worth a separate fix: value completed periods at the last instant of the final day (end − 1 ms). It will change existing AUM figures and tests, so do it deliberately.',
    acceptedOn: ACCEPTED,
    source: 'src/pages/Reports.tsx · endAsOf, src/lib/periodReports.ts · computeHoldingsAt',
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
];
