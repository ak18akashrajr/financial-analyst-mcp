/**
 * Net-worth movement attribution — "what actually moved my number between two points in time".
 *
 * Net worth is, by definition (usePortfolio.ts summary, record_net_worth_snapshot SQL, buildSnapshot):
 *
 *     NW = holdings value + Operating Cash + Cash Reserve (Vault) + PF − Liabilities
 *
 * so the change between any two points splits EXACTLY into one term per component. The only
 * component that needs a further split is holdings value, because it moves for two different reasons:
 *
 *   holdings Δ  =  new money put in / taken out (buys − sells)   +   price movement on holdings
 *
 * Price movement is the residual (holdings Δ − net trades), so the rows always sum to the total
 * change by construction. Nothing here is estimated or modelled — every row is either a difference
 * of two stored/derived balances or a sum over real transactions in the window.
 *
 * Trade inclusion uses the same rule buildSnapshot/computeHoldingsAt use to decide which trades are
 * in a holding position (`tradeDate <= asOf`), applied to the window (start, end], so the trades
 * counted here are exactly the ones that entered the holdings value between the two points.
 */
import type { Transaction } from '@/types/portfolio';
import { parseLocalDate } from './dateUtils';
import type { PeriodSnapshot } from './periodReports';

/** Rows smaller than this (₹) are treated as zero — mirrors NET_WORTH_CHANGE_EPSILON's intent. */
export const MOVEMENT_EPSILON = 0.01;

export type BridgeKey = 'newMoney' | 'priceMovement' | 'operatingCash' | 'vaultCash' | 'pfBalance' | 'liabilities';
export type BridgeGroup = 'holdings' | 'balances';

export interface BridgeBalances {
  holdingsValue: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
}

export interface BridgeRow {
  key: BridgeKey;
  label: string;
  group: BridgeGroup;
  /** Signed ₹ contribution to the change in net worth. */
  amount: number;
  /** Contribution in percentage points of the opening net worth (null if opening ≤ 0). Rows sum to changePct. */
  pts: number | null;
  /** This row ÷ total change × 100 (null when total change is ~0). Can exceed ±100% when rows offset. */
  share: number | null;
  /** Opening / closing balance of the underlying account (not defined for newMoney / priceMovement). */
  opening?: number;
  closing?: number;
}

export interface TradeLine {
  date: Date;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  value: number;
}

export interface TradeFlow {
  buyValue: number;
  sellValue: number;
  /** buys − sells. Positive = money moved into holdings. */
  net: number;
  buyCount: number;
  sellCount: number;
  trades: TradeLine[];
}

export interface NetWorthBridge {
  /** The component balances at both ends, so an audit can show every input rather than only the differences. */
  opening: BridgeBalances;
  closing: BridgeBalances;
  openingNetWorth: number;
  closingNetWorth: number;
  /** closing − opening. */
  change: number;
  /** change ÷ opening × 100, null when opening ≤ 0. */
  changePct: number | null;
  rows: BridgeRow[];
  holdingsSubtotal: { amount: number; pts: number | null; share: number | null };
  balancesSubtotal: { amount: number; pts: number | null; share: number | null };
  /** Σ rows. Equals `change` unless stated net-worth values disagree with their own components. */
  explained: number;
  /** change − explained. Non-zero only when stored net_worth ≠ its own components (legacy/odd rows). */
  unreconciled: number;
  flow: TradeFlow;
}

const ROW_LABELS: Record<BridgeKey, string> = {
  newMoney: 'New money invested (buys − sells)',
  priceMovement: 'Price movement on holdings',
  operatingCash: 'Operating Cash balance',
  vaultCash: 'Cash Reserve (Vault) balance',
  pfBalance: 'PF (PPF/EPF) balance',
  liabilities: 'Liabilities (reduction = gain)',
};

export function componentNetWorth(b: BridgeBalances): number {
  return b.holdingsValue + b.liquidCash + b.vaultCash + b.pfBalance - b.creditCardDebt;
}

/** Trades whose date falls in (after, upTo] — the ones buildSnapshot adds to holdings between the two instants. */
export function tradeFlowBetween(transactions: Transaction[], after: Date, upTo: Date, symbol?: string): TradeFlow {
  let buyValue = 0, sellValue = 0, buyCount = 0, sellCount = 0;
  const trades: TradeLine[] = [];
  for (const t of transactions) {
    if (symbol !== undefined && t.symbol !== symbol) continue;
    const d = parseLocalDate(t.date);
    if (!(d > after && d <= upTo)) continue;
    const value = t.quantity * t.price;
    if (t.type === 'BUY') { buyValue += value; buyCount++; } else { sellValue += value; sellCount++; }
    trades.push({ date: d, symbol: t.symbol, type: t.type, quantity: t.quantity, price: t.price, value });
  }
  trades.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { buyValue, sellValue, net: buyValue - sellValue, buyCount, sellCount, trades };
}

/**
 * Symbols traded in a window that have no usable stored price. record_net_worth_snapshot() values a
 * symbol with no current_prices row at ₹0, so a buy of one shows up as "new money" plus an equal,
 * spurious "price loss" in a snapshot-based (Seasonality) bridge. Returns them so the audit can say so.
 */
export function unpricedTradedSymbols(trades: TradeLine[], currentPrices: Record<string, number>): string[] {
  const seen = new Set<string>();
  for (const t of trades) {
    const p = currentPrices[t.symbol];
    if (!(typeof p === 'number' && p > 0)) seen.add(t.symbol);
  }
  return [...seen].sort();
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

function shareOf(amount: number, total: number): number | null {
  return Math.abs(total) > MOVEMENT_EPSILON ? (amount / total) * 100 : null;
}

export interface ComputeBridgeOptions {
  /** Use the stored net-worth values for opening/closing (Seasonality's cell % is based on these). */
  statedOpening?: number;
  statedClosing?: number;
}

export function computeBridge(
  open: BridgeBalances,
  close: BridgeBalances,
  flow: TradeFlow,
  options: ComputeBridgeOptions = {},
): NetWorthBridge {
  const holdingsDelta = close.holdingsValue - open.holdingsValue;
  const amounts: Record<BridgeKey, number> = {
    newMoney: flow.net,
    priceMovement: holdingsDelta - flow.net,
    operatingCash: close.liquidCash - open.liquidCash,
    vaultCash: close.vaultCash - open.vaultCash,
    pfBalance: close.pfBalance - open.pfBalance,
    // A liability going DOWN raises net worth.
    liabilities: -(close.creditCardDebt - open.creditCardDebt),
  };
  const explained = Object.values(amounts).reduce((s, v) => s + v, 0);

  const openingNetWorth = options.statedOpening ?? componentNetWorth(open);
  const closingNetWorth = options.statedClosing ?? componentNetWorth(close);
  const change = closingNetWorth - openingNetWorth;

  const accounts: Partial<Record<BridgeKey, [number, number]>> = {
    operatingCash: [open.liquidCash, close.liquidCash],
    vaultCash: [open.vaultCash, close.vaultCash],
    pfBalance: [open.pfBalance, close.pfBalance],
    liabilities: [open.creditCardDebt, close.creditCardDebt],
  };
  const groupOf: Record<BridgeKey, BridgeGroup> = {
    newMoney: 'holdings', priceMovement: 'holdings',
    operatingCash: 'balances', vaultCash: 'balances', pfBalance: 'balances', liabilities: 'balances',
  };
  const order: BridgeKey[] = ['newMoney', 'priceMovement', 'operatingCash', 'vaultCash', 'pfBalance', 'liabilities'];
  const rows: BridgeRow[] = order.map((key) => ({
    key,
    label: ROW_LABELS[key],
    group: groupOf[key],
    amount: amounts[key],
    pts: ratio(amounts[key], openingNetWorth),
    share: shareOf(amounts[key], change),
    opening: accounts[key]?.[0],
    closing: accounts[key]?.[1],
  }));

  const subtotal = (group: BridgeGroup) => {
    const amount = rows.filter((r) => r.group === group).reduce((s, r) => s + r.amount, 0);
    return { amount, pts: ratio(amount, openingNetWorth), share: shareOf(amount, change) };
  };

  return {
    opening: open,
    closing: close,
    openingNetWorth,
    closingNetWorth,
    change,
    changePct: ratio(change, openingNetWorth),
    rows,
    holdingsSubtotal: subtotal('holdings'),
    balancesSubtotal: subtotal('balances'),
    explained,
    unreconciled: change - explained,
    flow,
  };
}

// ───────────────────────────── Reports (quarter / half / year) ─────────────────────────────

export interface HoldingMovement {
  symbol: string;
  openingQty: number;
  openingPrice: number;
  openingValue: number;
  closingQty: number;
  closingPrice: number;
  closingValue: number;
  newMoney: number;
  priceMovement: number;
  /** closing − opening. */
  delta: number;
}

export interface PeriodBridge extends NetWorthBridge {
  openingAsOf: Date;
  closingAsOf: Date;
  holdingMovements: HoldingMovement[];
  /** Human-readable data-quality notes that qualify the numbers (empty when everything is clean). */
  caveats: string[];
}

export function snapshotBalances(s: PeriodSnapshot): BridgeBalances {
  return {
    holdingsValue: s.currentValue,
    liquidCash: s.liquidCash,
    vaultCash: s.vaultCash,
    pfBalance: s.pfBalance,
    creditCardDebt: s.creditCardDebt,
  };
}

/**
 * Bridge between two PeriodSnapshots built by buildSnapshot. Opening/closing net worth are the
 * snapshots' own `netWorth`, i.e. exactly the numbers the Reports page already displays as AUM.
 */
export function buildPeriodBridge(start: PeriodSnapshot, end: PeriodSnapshot, transactions: Transaction[]): PeriodBridge {
  const flow = tradeFlowBetween(transactions, start.asOf, end.asOf);
  const bridge = computeBridge(snapshotBalances(start), snapshotBalances(end), flow);

  // Per-symbol split. Σ over symbols of each field equals the portfolio-level figure above, because
  // both snapshots' currentValue is the sum of their holdings and flows are partitioned by symbol.
  const startBy = new Map(start.holdings.map((h) => [h.symbol, h]));
  const endBy = new Map(end.holdings.map((h) => [h.symbol, h]));
  const symbols = new Set<string>([...startBy.keys(), ...endBy.keys(), ...flow.trades.map((t) => t.symbol)]);
  const holdingMovements: HoldingMovement[] = [...symbols].map((symbol) => {
    const o = startBy.get(symbol);
    const c = endBy.get(symbol);
    const openingValue = o?.currentValue ?? 0;
    const closingValue = c?.currentValue ?? 0;
    const newMoney = tradeFlowBetween(transactions, start.asOf, end.asOf, symbol).net;
    const delta = closingValue - openingValue;
    return {
      symbol,
      openingQty: o?.totalQuantity ?? 0, openingPrice: o?.currentPrice ?? 0, openingValue,
      closingQty: c?.totalQuantity ?? 0, closingPrice: c?.currentPrice ?? 0, closingValue,
      newMoney, priceMovement: delta - newMoney, delta,
    };
  }).filter((m) => Math.abs(m.delta) > MOVEMENT_EPSILON || Math.abs(m.newMoney) > MOVEMENT_EPSILON)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const caveats: string[] = [];
  if (start.cashSource === 'none') {
    caveats.push('No net-worth snapshot exists at or before the opening date, so opening Operating Cash, Vault, PF and Liabilities are ₹0 by design. The full closing balances therefore show up as "balance change".');
  }
  if (end.cashSource === 'none') {
    caveats.push('No net-worth snapshot exists at or before the closing date, so closing balances are ₹0 by design.');
  }
  const costMarked = (s: PeriodSnapshot) => s.priceSourceCounts.costFallback + s.priceSourceCounts.none;
  if (costMarked(start) > 0 || costMarked(end) > 0) {
    caveats.push(`${costMarked(start)} opening / ${costMarked(end)} closing holding(s) are marked at cost (no price found), which flattens their price movement to ₹0.`);
  }
  if (bridge.openingNetWorth <= 0) {
    caveats.push('Opening net worth is ₹0 or negative, so percentage contributions are not defined.');
  }

  return { ...bridge, openingAsOf: start.asOf, closingAsOf: end.asOf, holdingMovements, caveats };
}

// ───────────────────────────── Seasonality (month over month) ─────────────────────────────

export interface NetWorthSnapshotRow {
  recorded_at: string;
  net_worth: number;
  portfolio_value: number;
  liquid_cash: number;
  vault_cash: number;
  pf_balance: number;
  credit_card_debt: number;
}

interface SnapPoint {
  at: Date;
  netWorth: number;
  balances: BridgeBalances;
}

export interface BalanceChange {
  label: string;
  from: number;
  to: number;
}

export interface LedgerEntry {
  at: Date;
  /** Cash-type balances that were edited at this snapshot (exact from → to). */
  balanceChanges: BalanceChange[];
  holdingsDelta: number;
  newMoney: number;
  priceMovement: number;
  /** Change in components' net worth vs the previous snapshot. */
  netWorthDelta: number;
}

export interface MonthMovement {
  fy: number;
  /** 0 = April … 11 = March. */
  monthIdx: number;
  /** Stored-net-worth based month-over-month %, identical to the heatmap cell. */
  pct: number;
  opening: { at: Date; netWorth: number };
  closing: { at: Date; netWorth: number };
  bridge: NetWorthBridge;
  ledger: LedgerEntry[];
}

/** Indian FY (April start) a date falls in, by its start year. */
export function fyFor(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

/** 0 = April … 11 = March. */
export function fyMonthIdx(d: Date): number {
  return (d.getMonth() - 3 + 12) % 12;
}

function toPoint(r: NetWorthSnapshotRow): SnapPoint {
  return {
    at: new Date(r.recorded_at),
    netWorth: Number(r.net_worth),
    balances: {
      holdingsValue: Number(r.portfolio_value),
      liquidCash: Number(r.liquid_cash),
      vaultCash: Number(r.vault_cash),
      pfBalance: Number(r.pf_balance),
      creditCardDebt: Number(r.credit_card_debt),
    },
  };
}

const BALANCE_FIELDS: Array<{ key: keyof BridgeBalances; label: string }> = [
  { key: 'liquidCash', label: 'Operating Cash' },
  { key: 'vaultCash', label: 'Cash Reserve (Vault)' },
  { key: 'pfBalance', label: 'PF (PPF/EPF)' },
  { key: 'creditCardDebt', label: 'Liabilities' },
];

function ledgerEntry(prev: SnapPoint, cur: SnapPoint, transactions: Transaction[]): LedgerEntry {
  const flow = tradeFlowBetween(transactions, prev.at, cur.at);
  const holdingsDelta = cur.balances.holdingsValue - prev.balances.holdingsValue;
  const balanceChanges: BalanceChange[] = BALANCE_FIELDS
    .filter(({ key }) => Math.abs(cur.balances[key] - prev.balances[key]) > MOVEMENT_EPSILON)
    .map(({ key, label }) => ({ label, from: prev.balances[key], to: cur.balances[key] }));
  return {
    at: cur.at,
    balanceChanges,
    holdingsDelta,
    newMoney: flow.net,
    priceMovement: holdingsDelta - flow.net,
    netWorthDelta: componentNetWorth(cur.balances) - componentNetWorth(prev.balances),
  };
}

export interface MonthlyMovements {
  /** FY start years that have at least one snapshot, ascending. */
  fys: number[];
  /** fys.length × 12; null when the month or its predecessor has no snapshot (or predecessor NW is 0). */
  grid: Array<Array<MonthMovement | null>>;
}

/**
 * Month-over-month net-worth movement. A month's value is its LAST net_worth_history snapshot (same rule
 * the Seasonality heatmap has always used); April's predecessor is the prior FY's March. `pct` matches the
 * heatmap's previous inline computation exactly, and each cell additionally carries the full attribution.
 */
export function buildMonthlyMovements(rows: NetWorthSnapshotRow[], transactions: Transaction[] = []): MonthlyMovements {
  const points = rows.map(toPoint).sort((a, b) => a.at.getTime() - b.at.getTime());

  const byMonth = new Map<string, SnapPoint[]>();
  const lastInMonth = new Map<string, SnapPoint>();
  for (const p of points) {
    const key = `${fyFor(p.at)}-${fyMonthIdx(p.at)}`;
    (byMonth.get(key) ?? byMonth.set(key, []).get(key)!).push(p);
    const cur = lastInMonth.get(key);
    if (!cur || p.at > cur.at) lastInMonth.set(key, p);
  }

  const fys = Array.from(new Set(points.map((p) => fyFor(p.at)))).sort((a, b) => a - b);
  const grid = fys.map((fy) => {
    const row: Array<MonthMovement | null> = [];
    for (let m = 0; m < 12; m++) {
      const closing = lastInMonth.get(`${fy}-${m}`);
      const opening = lastInMonth.get(m === 0 ? `${fy - 1}-11` : `${fy}-${m - 1}`);
      if (!closing || !opening || opening.netWorth === 0) { row.push(null); continue; }

      const chain = [opening, ...(byMonth.get(`${fy}-${m}`) ?? [])];
      const ledger: LedgerEntry[] = [];
      for (let i = 1; i < chain.length; i++) ledger.push(ledgerEntry(chain[i - 1], chain[i], transactions));

      const flow = tradeFlowBetween(transactions, opening.at, closing.at);
      const bridge = computeBridge(opening.balances, closing.balances, flow, {
        statedOpening: opening.netWorth,
        statedClosing: closing.netWorth,
      });
      row.push({
        fy,
        monthIdx: m,
        pct: ((closing.netWorth - opening.netWorth) / opening.netWorth) * 100,
        opening: { at: opening.at, netWorth: opening.netWorth },
        closing: { at: closing.at, netWorth: closing.netWorth },
        bridge,
        ledger,
      });
    }
    return row;
  });

  return { fys, grid };
}
