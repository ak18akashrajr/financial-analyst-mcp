// Independent cross-check of src/lib/netWorthMovement.ts.
//
// The lib computes "price movement" as a RESIDUAL (Δ holdings value − net trades). That always adds up
// by construction, so adding up proves nothing about whether the residual is the *right* number. Here
// we simulate random histories (trades, silent market moves, balance edits) and compare the residual
// against a completely different, per-share formula:
//
//   price effect = Σ_symbols [ qty_open × (P_close − P_open)  +  Σ_trades signedQty × (P_close − tradePrice) ]
//
// i.e. every share held at the start earns the move over the whole window, and every share traded
// inside the window earns the move from its trade price to the close. If the two agree on hundreds of
// random histories, the attribution means what the UI says it means.
import { describe, expect, it } from 'vitest';
import { buildMonthlyMovements, buildPeriodBridge, type NetWorthSnapshotRow } from '@/lib/netWorthMovement';
import { buildPeriods, buildSnapshot, periodClosingAsOf, periodOpeningAsOf, type HistoricalPriceMap, type NetWorthHistoryRow } from '@/lib/periodReports';
import type { Transaction } from '@/types/portfolio';

function rng(seed: number) {
  // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SYMS = ['AAA', 'BBB', 'CCC'];

describe('Seasonality attribution vs per-share oracle (SQL-style snapshots)', () => {
  it.each(Array.from({ length: 60 }, (_, i) => i + 1))('random history, seed %i', (seed) => {
    const r = rng(seed);
    const price: Record<string, number> = { AAA: 100, BBB: 250, CCC: 40 };
    const held: Record<string, number> = { AAA: 0, BBB: 0, CCC: 0 };
    const bal = { liquid: 20_000, vault: 90_000, pf: 100_000, debt: 10_000 };
    const txs: Transaction[] = [];
    const rows: NetWorthSnapshotRow[] = [];
    const marks: Array<{ at: number; price: Record<string, number>; held: Record<string, number> }> = [];
    const tradeLog: Array<{ at: number; symbol: string; signedQty: number; price: number }> = [];

    const day0 = new Date(2026, 6, 1); // Jul 1 → ~Dec
    for (let d = 0; d < 170; d++) {
      const day = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + d);
      // Silent market move every day (no snapshot is written by a price move).
      for (const s of SYMS) price[s] = Math.max(1, +(price[s] * (1 + (r() - 0.5) * 0.06)).toFixed(2));
      const roll = r();
      if (roll > 0.35) continue; // most days: nothing recorded
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime();
      if (roll < 0.2) {
        const s = SYMS[Math.floor(r() * 3)];
        const buy = held[s] === 0 || r() < 0.6;
        const qty = buy ? 1 + Math.floor(r() * 20) : 1 + Math.floor(r() * held[s]);
        txs.push({ id: String(txs.length), symbol: s, type: buy ? 'BUY' : 'SELL', quantity: qty, price: price[s], date: ymd(day) });
        held[s] += buy ? qty : -qty;
        tradeLog.push({ at, symbol: s, signedQty: buy ? qty : -qty, price: price[s] });
      } else {
        const k = (['liquid', 'vault', 'pf', 'debt'] as const)[Math.floor(r() * 4)];
        bal[k] = Math.max(0, Math.round(bal[k] + (r() - 0.45) * 40_000));
      }
      // Snapshot exactly as record_net_worth_snapshot does: Σ net qty × current price.
      const portfolio = SYMS.reduce((sum, s) => sum + held[s] * price[s], 0);
      rows.push({
        recorded_at: new Date(at).toISOString(), portfolio_value: portfolio,
        liquid_cash: bal.liquid, vault_cash: bal.vault, pf_balance: bal.pf, credit_card_debt: bal.debt,
        net_worth: portfolio + bal.liquid + bal.vault + bal.pf - bal.debt,
      });
      marks.push({ at, price: { ...price }, held: { ...held } });
    }

    const { grid } = buildMonthlyMovements(rows, txs);
    let checked = 0;
    for (const m of grid.flat()) {
      if (!m) continue;
      const o = marks.find((x) => x.at === m.opening.at.getTime())!;
      const c = marks.find((x) => x.at === m.closing.at.getTime())!;
      let oracleNewMoney = 0, oraclePrice = 0;
      for (const s of SYMS) {
        oraclePrice += o.held[s] * (c.price[s] - o.price[s]);
        for (const t of tradeLog) {
          if (t.symbol !== s || !(t.at > o.at && t.at <= c.at)) continue;
          oracleNewMoney += t.signedQty * t.price;
          oraclePrice += t.signedQty * (c.price[s] - t.price);
        }
      }
      const find = (k: string) => m.bridge.rows.find((x) => x.key === k)!.amount;
      expect(find('newMoney')).toBeCloseTo(oracleNewMoney, 6);
      expect(find('priceMovement')).toBeCloseTo(oraclePrice, 6);
      // And the whole thing still ties to the number on the heatmap.
      expect(m.bridge.rows.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(m.closing.netWorth - m.opening.netWorth, 6);
      expect(m.bridge.unreconciled).toBeCloseTo(0, 6);
      expect(m.ledger.reduce((s, e) => s + e.netWorthDelta, 0)).toBeCloseTo(m.bridge.change, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Reports period bridge vs per-share oracle', () => {
  it.each(Array.from({ length: 60 }, (_, i) => i + 101))('random history, seed %i', (seed) => {
    const r = rng(seed);
    // Daily closes for every calendar day Mar 1 2026 → Dec 31 2026, random walk.
    const hist: HistoricalPriceMap = {};
    const closeOn: Record<string, Record<string, number>> = {};
    for (const [s, start] of [['AAA', 100], ['BBB', 250], ['CCC', 40]] as const) {
      let p: number = start; hist[s] = []; closeOn[s] = {};
      for (let d = new Date(2026, 2, 1); d <= new Date(2026, 11, 31); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        p = Math.max(1, +(p * (1 + (r() - 0.5) * 0.05)).toFixed(2));
        hist[s].push({ date: ymd(d), close: p }); closeOn[s][ymd(d)] = p;
      }
    }
    // Random trades Apr 1 → Nov 30 (never oversell).
    const held: Record<string, number> = { AAA: 0, BBB: 0, CCC: 0 };
    const txs: Transaction[] = [];
    for (let d = new Date(2026, 3, 1); d <= new Date(2026, 10, 30); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (r() > 0.12) continue;
      const s = SYMS[Math.floor(r() * 3)];
      const buy = held[s] === 0 || r() < 0.65;
      const qty = buy ? 1 + Math.floor(r() * 15) : 1 + Math.floor(r() * held[s]);
      txs.push({ id: String(txs.length), symbol: s, type: buy ? 'BUY' : 'SELL', quantity: qty, price: closeOn[s][ymd(d)], date: ymd(d) });
      held[s] += buy ? qty : -qty;
    }
    // A couple of cash snapshots so the cash side is exercised too.
    const history: NetWorthHistoryRow[] = [
      { recorded_at: new Date(2026, 3, 2, 9).toISOString(), net_worth: 0, portfolio_value: 0, liquid_cash: 10_000, vault_cash: 50_000, pf_balance: 100_000, credit_card_debt: 5_000 },
      { recorded_at: new Date(2026, 7, 14, 9).toISOString(), net_worth: 0, portfolio_value: 0, liquid_cash: 13_000, vault_cash: 80_000, pf_balance: 100_000, credit_card_debt: 0 },
    ];
    const cash = { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 };

    for (const type of ['quarter', 'half'] as const) {
      for (const p of buildPeriods(2026, type)) {
        if (p.end > new Date(2026, 11, 31)) continue;
        // Measured exactly as Reports.tsx does: previous day's last instant → the period's own last instant.
        const open = periodOpeningAsOf(p);
        const close = periodClosingAsOf(p, 'completed');
        const a = buildSnapshot(open, txs, {}, {}, history, cash, { historicalPrices: hist });
        const b = buildSnapshot(close, txs, {}, {}, history, cash, { historicalPrices: hist });
        const bridge = buildPeriodBridge(a, b, txs);

        let oracleNewMoney = 0, oraclePrice = 0;
        const closeAt = (s: string, d: Date) => closeOn[s][ymd(d)];
        for (const s of SYMS) {
          const qOpen = txs.filter((t) => t.symbol === s && new Date(t.date + 'T00:00:00') <= open)
            .reduce((q, t) => q + (t.type === 'BUY' ? t.quantity : -t.quantity), 0);
          oraclePrice += qOpen * (closeAt(s, close) - closeAt(s, open));
          for (const t of txs) {
            const td = new Date(t.date + 'T00:00:00');
            if (t.symbol !== s || !(td > open && td <= close)) continue;
            const sq = t.type === 'BUY' ? t.quantity : -t.quantity;
            oracleNewMoney += sq * t.price;
            oraclePrice += sq * (closeAt(s, close) - t.price);
          }
        }
        const find = (k: string) => bridge.rows.find((x) => x.key === k)!.amount;
        expect(find('newMoney')).toBeCloseTo(oracleNewMoney, 6);
        expect(find('priceMovement')).toBeCloseTo(oraclePrice, 6);
        expect(bridge.openingNetWorth).toBeCloseTo(a.netWorth, 9);
        expect(bridge.closingNetWorth).toBeCloseTo(b.netWorth, 9);
        expect(bridge.rows.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(b.netWorth - a.netWorth, 6);
        // Per-holding rows add back to the portfolio totals.
        expect(bridge.holdingMovements.reduce((s, m) => s + m.priceMovement, 0)).toBeCloseTo(find('priceMovement'), 6);
        expect(bridge.holdingMovements.reduce((s, m) => s + m.newMoney, 0)).toBeCloseTo(find('newMoney'), 6);
      }
    }
  });
});
