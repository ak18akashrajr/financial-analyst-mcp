// Net-worth movement attribution (src/lib/netWorthMovement.ts) powers the click-to-audit on the
// Seasonality heatmap and the Reports "What moved" card. These are money numbers used for real
// decisions, so every expectation below is a hand-computed figure, and the core invariant —
// the rows add up EXACTLY to the total change — is asserted on every scenario.
import { describe, expect, it } from 'vitest';
import {
  buildMonthlyMovements,
  buildPeriodBridge,
  computeBridge,
  tradeFlowBetween,
  unpricedTradedSymbols,
  type NetWorthSnapshotRow,
} from '@/lib/netWorthMovement';
import { buildPeriods, buildSnapshot, type NetWorthHistoryRow } from '@/lib/periodReports';
import type { Transaction } from '@/types/portfolio';

// Build a recorded_at from LOCAL wall-clock parts so month bucketing is timezone-independent
// (the heatmap groups by the viewer's local month).
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

function snap(
  recorded_at: string,
  p: { portfolio: number; liquid: number; vault: number; pf: number; debt: number; netWorth?: number },
): NetWorthSnapshotRow {
  return {
    recorded_at,
    portfolio_value: p.portfolio,
    liquid_cash: p.liquid,
    vault_cash: p.vault,
    pf_balance: p.pf,
    credit_card_debt: p.debt,
    net_worth: p.netWorth ?? p.portfolio + p.liquid + p.vault + p.pf - p.debt,
  };
}

const sumRows = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
const row = (b: { rows: { key: string; amount: number; pts: number | null; share: number | null }[] }, key: string) =>
  b.rows.find((r) => r.key === key)!;

describe('computeBridge', () => {
  const open = { holdingsValue: 500_000, liquidCash: 20_000, vaultCash: 90_000, pfBalance: 100_000, creditCardDebt: 10_000 };
  const noFlow = { buyValue: 0, sellValue: 0, net: 0, buyCount: 0, sellCount: 0, trades: [] };

  it('attributes a pure Vault balance update 100% to the balance, nothing to holdings', () => {
    const b = computeBridge(open, { ...open, vaultCash: 150_000 }, noFlow);
    expect(b.openingNetWorth).toBe(700_000);
    expect(b.closingNetWorth).toBe(760_000);
    expect(b.change).toBe(60_000);
    expect(row(b, 'vaultCash').amount).toBe(60_000);
    expect(row(b, 'vaultCash').share).toBeCloseTo(100, 10);
    expect(row(b, 'vaultCash').pts).toBeCloseTo((60_000 / 700_000) * 100, 10);
    expect(b.holdingsSubtotal.amount).toBe(0);
    expect(b.balancesSubtotal.amount).toBe(60_000);
    expect(b.unreconciled).toBe(0);
  });

  it('splits a holdings change into new money and price movement, and rows always sum to the change', () => {
    const flow = { buyValue: 10_000, sellValue: 0, net: 10_000, buyCount: 1, sellCount: 0, trades: [] };
    const close = { ...open, holdingsValue: 520_000, vaultCash: 150_000 };
    const b = computeBridge(open, close, flow);
    expect(row(b, 'newMoney').amount).toBe(10_000);
    expect(row(b, 'priceMovement').amount).toBe(10_000); // 20,000 holdings Δ − 10,000 bought
    expect(row(b, 'vaultCash').amount).toBe(60_000);
    expect(b.change).toBe(80_000);
    expect(sumRows(b.rows)).toBe(b.change);
    // pts add up to the total % growth.
    const ptsTotal = b.rows.reduce((s, r) => s + (r.pts ?? 0), 0);
    expect(ptsTotal).toBeCloseTo(b.changePct!, 10);
    // shares add up to 100%.
    expect(b.rows.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(100, 10);
  });

  it('treats a selling month correctly: proceeds leaving holdings are negative new money, not a price loss', () => {
    // Sold 15,000 worth, no price change on the rest → holdings fall by exactly 15,000.
    const flow = { buyValue: 0, sellValue: 15_000, net: -15_000, buyCount: 0, sellCount: 1, trades: [] };
    const b = computeBridge(open, { ...open, holdingsValue: 485_000 }, flow);
    expect(row(b, 'newMoney').amount).toBe(-15_000);
    expect(row(b, 'priceMovement').amount).toBe(0);
  });

  it('counts a liability reduction as a gain and an increase as a loss', () => {
    const down = computeBridge(open, { ...open, creditCardDebt: 4_000 }, noFlow);
    expect(row(down, 'liabilities').amount).toBe(6_000);
    const up = computeBridge(open, { ...open, creditCardDebt: 15_000 }, noFlow);
    expect(row(up, 'liabilities').amount).toBe(-5_000);
    expect(sumRows(up.rows)).toBe(up.change);
  });

  it('returns null pts / shares instead of dividing by zero', () => {
    const zero = { holdingsValue: 0, liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
    const b = computeBridge(zero, zero, noFlow);
    expect(b.changePct).toBeNull();
    expect(b.rows.every((r) => r.pts === null && r.share === null)).toBe(true);
  });

  it('surfaces an unreconciled amount when stated net worth disagrees with its components', () => {
    const b = computeBridge(open, { ...open, vaultCash: 150_000 }, noFlow, { statedOpening: 700_000, statedClosing: 765_000 });
    expect(b.change).toBe(65_000);
    expect(b.explained).toBe(60_000);
    expect(b.unreconciled).toBe(5_000);
  });
});

describe('tradeFlowBetween window rule', () => {
  const tx = (id: string, date: string, type: 'BUY' | 'SELL', quantity: number, price: number, symbol = 'AAA'): Transaction =>
    ({ id, symbol, type, quantity, price, date });

  it('is (after, upTo]: a trade at the opening instant belongs to the earlier window, one at the closing instant to this one', () => {
    const oct1 = new Date(2026, 9, 1);
    const nov1 = new Date(2026, 10, 1);
    const txs = [tx('a', '2026-10-01', 'BUY', 1, 100), tx('b', '2026-10-15', 'BUY', 2, 100), tx('c', '2026-11-01', 'SELL', 1, 150)];
    const f = tradeFlowBetween(txs, oct1, nov1);
    expect(f.buyValue).toBe(200); // only 'b'
    expect(f.sellValue).toBe(150); // 'c' lands on the closing instant → included
    expect(f.net).toBe(50);
    expect(f.trades.map((t) => t.symbol + t.type)).toEqual(['AAABUY', 'AAASELL']);
  });

  it('filters by symbol', () => {
    const txs = [tx('a', '2026-10-15', 'BUY', 1, 100, 'AAA'), tx('b', '2026-10-16', 'BUY', 1, 300, 'BBB')];
    expect(tradeFlowBetween(txs, new Date(2026, 9, 1), new Date(2026, 10, 1), 'BBB').net).toBe(300);
  });
});

describe('unpricedTradedSymbols', () => {
  const line = (symbol: string) => ({ date: new Date(), symbol, type: 'BUY' as const, quantity: 1, price: 10, value: 10 });
  it('flags traded symbols with a missing or zero stored price, once each', () => {
    expect(unpricedTradedSymbols([line('NEW'), line('NEW'), line('OK'), line('ZERO')], { OK: 5, ZERO: 0 })).toEqual(['NEW', 'ZERO']);
  });
  it('flags nothing when every traded symbol is priced', () => {
    expect(unpricedTradedSymbols([line('OK')], { OK: 5 })).toEqual([]);
  });
});

describe('buildMonthlyMovements (Seasonality)', () => {
  const sep30 = snap(at(2026, 9, 30, 18), { portfolio: 500_000, liquid: 20_000, vault: 90_000, pf: 100_000, debt: 10_000 });

  it('reproduces the reported scenario: Vault 90,000 on Sep 30 → 1,50,000 on Oct 1 shows up as a balance update', () => {
    const oct1 = snap(at(2026, 10, 1, 10), { portfolio: 500_000, liquid: 20_000, vault: 150_000, pf: 100_000, debt: 10_000 });
    const { fys, grid } = buildMonthlyMovements([sep30, oct1], []);
    expect(fys).toEqual([2026]);
    const oct = grid[0][6]!; // 0 = Apr … 6 = Oct
    expect(oct.pct).toBeCloseTo((60_000 / 700_000) * 100, 10);
    expect(oct.bridge.change).toBe(60_000);
    expect(row(oct.bridge, 'vaultCash').amount).toBe(60_000);
    expect(oct.bridge.holdingsSubtotal.amount).toBe(0);
    expect(oct.ledger).toHaveLength(1);
    expect(oct.ledger[0].balanceChanges).toEqual([{ label: 'Cash Reserve (Vault)', from: 90_000, to: 150_000 }]);
    expect(oct.ledger[0].netWorthDelta).toBe(60_000);
  });

  it('separates new money, price movement and balance edits across several snapshots in one month', () => {
    const txs: Transaction[] = [{ id: 't1', symbol: 'AAA', type: 'BUY', quantity: 10, price: 1_000, date: '2026-10-05' }];
    const oct5 = snap(at(2026, 10, 5, 12), { portfolio: 512_000, liquid: 20_000, vault: 90_000, pf: 100_000, debt: 10_000 });
    const oct20 = snap(at(2026, 10, 20, 10), { portfolio: 520_000, liquid: 20_000, vault: 150_000, pf: 100_000, debt: 10_000 });
    const oct = buildMonthlyMovements([sep30, oct5, oct20], txs).grid[0][6]!;

    expect(oct.bridge.change).toBe(80_000);
    expect(row(oct.bridge, 'newMoney').amount).toBe(10_000);
    expect(row(oct.bridge, 'priceMovement').amount).toBe(10_000);
    expect(row(oct.bridge, 'vaultCash').amount).toBe(60_000);
    expect(row(oct.bridge, 'newMoney').share).toBeCloseTo(12.5, 10);
    expect(row(oct.bridge, 'vaultCash').share).toBeCloseTo(75, 10);
    expect(oct.pct).toBeCloseTo((80_000 / 700_000) * 100, 10);

    // Ledger: first snapshot = 10,000 new money + 2,000 price; second = 8,000 price + the vault edit.
    expect(oct.ledger).toHaveLength(2);
    expect(oct.ledger[0]).toMatchObject({ holdingsDelta: 12_000, newMoney: 10_000, priceMovement: 2_000, netWorthDelta: 12_000 });
    expect(oct.ledger[1]).toMatchObject({ holdingsDelta: 8_000, newMoney: 0, priceMovement: 8_000, netWorthDelta: 68_000 });
    // The ledger adds up to the month.
    expect(oct.ledger.reduce((s, e) => s + e.netWorthDelta, 0)).toBe(oct.bridge.change);
    expect(oct.ledger.reduce((s, e) => s + e.holdingsDelta, 0)).toBe(oct.bridge.holdingsSubtotal.amount);
  });

  it('uses the LAST snapshot of each month, like the heatmap always did', () => {
    const early = snap(at(2026, 10, 2), { portfolio: 999_999, liquid: 0, vault: 0, pf: 0, debt: 0 });
    const last = snap(at(2026, 10, 28), { portfolio: 500_000, liquid: 20_000, vault: 150_000, pf: 100_000, debt: 10_000 });
    const oct = buildMonthlyMovements([sep30, early, last], []).grid[0][6]!;
    expect(oct.closing.netWorth).toBe(760_000);
    expect(oct.pct).toBeCloseTo((60_000 / 700_000) * 100, 10);
  });

  it("compares April against the previous FY's March", () => {
    const mar = snap(at(2026, 3, 31), { portfolio: 100_000, liquid: 0, vault: 0, pf: 0, debt: 0 });
    const apr = snap(at(2026, 4, 30), { portfolio: 110_000, liquid: 0, vault: 0, pf: 0, debt: 0 });
    const { fys, grid } = buildMonthlyMovements([mar, apr], []);
    expect(fys).toEqual([2025, 2026]);
    expect(grid[1][0]!.pct).toBeCloseTo(10, 10);
    expect(grid[1][0]!.opening.netWorth).toBe(100_000);
  });

  it('leaves cells empty when the previous month has no snapshot or opening net worth is zero', () => {
    const oct = snap(at(2026, 10, 5), { portfolio: 1, liquid: 0, vault: 0, pf: 0, debt: 0 });
    expect(buildMonthlyMovements([oct], []).grid[0][6]).toBeNull();
    const zeroSep = snap(at(2026, 9, 30), { portfolio: 0, liquid: 0, vault: 0, pf: 0, debt: 0 });
    expect(buildMonthlyMovements([zeroSep, oct], []).grid[0][6]).toBeNull();
  });

  it('keeps the heatmap % on stored net_worth and exposes any mismatch as unreconciled', () => {
    const oct = snap(at(2026, 10, 1), { portfolio: 500_000, liquid: 20_000, vault: 150_000, pf: 100_000, debt: 10_000, netWorth: 765_000 });
    const cell = buildMonthlyMovements([sep30, oct], []).grid[0][6]!;
    expect(cell.pct).toBeCloseTo((65_000 / 700_000) * 100, 10);
    expect(cell.bridge.unreconciled).toBe(5_000);
    expect(cell.bridge.explained + cell.bridge.unreconciled).toBe(cell.bridge.change);
  });
});

describe('buildPeriodBridge (Reports)', () => {
  const q2 = buildPeriods(2026, 'quarter')[1]; // Jul 1 → Oct 1 2026
  const txs: Transaction[] = [
    { id: '1', symbol: 'SYM', type: 'BUY', quantity: 10, price: 100, date: '2026-04-10' },
    { id: '2', symbol: 'SYM', type: 'BUY', quantity: 5, price: 130, date: '2026-08-01' },
  ];
  const historicalPrices = {
    SYM: [{ date: '2026-06-30', close: 120 }, { date: '2026-09-30', close: 150 }],
  };
  const history: NetWorthHistoryRow[] = [
    { recorded_at: at(2026, 6, 30), net_worth: 61_200, portfolio_value: 1_200, liquid_cash: 10_000, vault_cash: 50_000, pf_balance: 0, credit_card_debt: 0 },
    { recorded_at: at(2026, 9, 29), net_worth: 92_250, portfolio_value: 2_250, liquid_cash: 10_000, vault_cash: 80_000, pf_balance: 0, credit_card_debt: 0 },
  ];
  const cash = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };
  const build = (h = history) => {
    const start = buildSnapshot(q2.start, txs, {}, {}, h, cash, { historicalPrices });
    const end = buildSnapshot(q2.end, txs, {}, {}, h, cash, { historicalPrices });
    return { start, end, bridge: buildPeriodBridge(start, end, txs) };
  };

  it('ties opening/closing to the snapshots and splits the change exactly', () => {
    const { start, end, bridge } = build();
    expect(bridge.openingNetWorth).toBe(start.netWorth);
    expect(bridge.closingNetWorth).toBe(end.netWorth);
    expect(bridge.openingNetWorth).toBe(61_200); // 10 × 120 + 10,000 + 50,000
    expect(bridge.closingNetWorth).toBe(92_250); // 15 × 150 + 10,000 + 80,000
    expect(bridge.change).toBe(31_050);

    expect(row(bridge, 'newMoney').amount).toBe(650); // 5 × 130, the Aug 1 buy
    expect(row(bridge, 'priceMovement').amount).toBe(400); // 10 × (150−120) + 5 × (150−130)
    expect(row(bridge, 'vaultCash').amount).toBe(30_000);
    expect(row(bridge, 'operatingCash').amount).toBe(0);
    expect(row(bridge, 'vaultCash').pts).toBeCloseTo((30_000 / 61_200) * 100, 10);

    expect(sumRows(bridge.rows)).toBeCloseTo(bridge.change, 9);
    expect(bridge.unreconciled).toBeCloseTo(0, 9);
    expect(bridge.caveats).toEqual([]);
  });

  it('breaks price movement down per holding and the per-holding rows add back to the totals', () => {
    const { bridge } = build();
    expect(bridge.holdingMovements).toHaveLength(1);
    expect(bridge.holdingMovements[0]).toMatchObject({ symbol: 'SYM', openingValue: 1_200, closingValue: 2_250, newMoney: 650, priceMovement: 400 });
    // The quantity × price behind each value is exposed so the audit can show it.
    expect(bridge.holdingMovements[0]).toMatchObject({ openingQty: 10, openingPrice: 120, closingQty: 15, closingPrice: 150 });
    // And every component balance at both ends is on the bridge itself.
    expect(bridge.opening).toEqual({ holdingsValue: 1_200, liquidCash: 10_000, vaultCash: 50_000, pfBalance: 0, creditCardDebt: 0 });
    expect(bridge.closing).toEqual({ holdingsValue: 2_250, liquidCash: 10_000, vaultCash: 80_000, pfBalance: 0, creditCardDebt: 0 });
    expect(bridge.holdingMovements.reduce((s, m) => s + m.priceMovement, 0)).toBeCloseTo(row(bridge, 'priceMovement').amount, 9);
  });

  it('warns when there is no cash snapshot at the opening date instead of silently presenting ₹0 as real', () => {
    const { bridge } = build([history[1]]);
    expect(bridge.caveats.some((c) => c.includes('opening Operating Cash'))).toBe(true);
    // The identity still holds even in that degraded case.
    expect(sumRows(bridge.rows)).toBeCloseTo(bridge.change, 9);
  });

  it('flags holdings marked at cost', () => {
    const start = buildSnapshot(q2.start, txs, {}, {}, history, cash, { historicalPrices: {} });
    const end = buildSnapshot(q2.end, txs, {}, {}, history, cash, { historicalPrices: {} });
    const bridge = buildPeriodBridge(start, end, txs);
    expect(bridge.caveats.some((c) => c.includes('marked at cost'))).toBe(true);
  });
});
