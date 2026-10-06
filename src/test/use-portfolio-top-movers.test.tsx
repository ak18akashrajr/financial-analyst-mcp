// usePortfolio's topMovers (audit M2): "Top Gainers" must only hold holdings that are actually up, and
// a holding must never appear in both lists. Previously `gainers` was just the top 3 by P&L%, so three
// holdings at +10% / -3% / -12% were ALL listed as "Top Gainers" (and two of them also as "Top Losers").
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

const { transactionRows, priceRows } = vi.hoisted(() => ({
  transactionRows: [] as Array<{ id: string; symbol: string; type: string; quantity: number; price: number; date: string }>,
  priceRows: [] as Array<{ symbol: string; price: number }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        // transactions are read via fetchAllPages: .order().order()[.eq()].range(from, to).
        return {
          select: () => ({
            order: () => ({
              order: () => {
                const q: any = {
                  eq: () => q,
                  range: (from: number, to: number) => Promise.resolve({ data: transactionRows.slice(from, to + 1), error: null }),
                };
                return q;
              },
            }),
          }),
        };
      }
      if (table === 'cash_settings') {
        return {
          select: () => Promise.resolve({
            data: [{ liquid_cash: 0, vault_cash: 0, pf_balance: 0, credit_card_debt: 0 }],
            error: null,
          }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: priceRows, error: null }) };
      }
      if (table === 'monthly_cashflow') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

/** One BUY of 10 @ ₹100 per symbol, priced at 100 x (1 + pct/100). */
function seed(positions: Record<string, number>) {
  transactionRows.length = 0;
  priceRows.length = 0;
  let i = 0;
  for (const [symbol, pct] of Object.entries(positions)) {
    transactionRows.push({ id: `t${i++}`, symbol, type: 'BUY', quantity: 10, price: 100, date: '2026-01-01' });
    priceRows.push({ symbol, price: 100 * (1 + pct / 100) });
  }
}

async function load() {
  const { result } = renderHook(() => usePortfolio());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.topMovers;
}

const symbols = (hs: Array<{ symbol: string }>) => hs.map(h => h.symbol);

describe('usePortfolio topMovers', () => {
  beforeEach(() => {
    transactionRows.length = 0;
    priceRows.length = 0;
  });

  it('lists only the genuinely-up holding as a gainer when the others are down (the audit example)', async () => {
    seed({ UP: 10, DOWN_SMALL: -3, DOWN_BIG: -12 });
    const { gainers, losers } = await load();

    expect(symbols(gainers)).toEqual(['UP']);
    expect(symbols(losers)).toEqual(['DOWN_BIG', 'DOWN_SMALL']); // worst first
  });

  it('never puts a holding in both lists', async () => {
    seed({ A: 5, B: -2 });
    const { gainers, losers } = await load();

    const both = symbols(gainers).filter(s => symbols(losers).includes(s));
    expect(both).toEqual([]);
    expect(symbols(gainers)).toEqual(['A']);
    expect(symbols(losers)).toEqual(['B']);
  });

  it('has no gainers when every holding is down, and no losers when every holding is up', async () => {
    seed({ A: -1, B: -5 });
    expect(symbols((await load()).gainers)).toEqual([]);

    seed({ A: 1, B: 5 });
    expect(symbols((await load()).losers)).toEqual([]);
  });

  it('treats a flat (0%) holding as neither a gainer nor a loser', async () => {
    seed({ FLAT: 0, UP: 4 });
    const { gainers, losers } = await load();

    expect(symbols(gainers)).toEqual(['UP']);
    expect(losers).toEqual([]);
  });

  it('still caps each list at three, best gainer first and worst loser first', async () => {
    seed({ G1: 30, G2: 20, G3: 10, G4: 5, L1: -5, L2: -10, L3: -20, L4: -30 });
    const { gainers, losers } = await load();

    expect(symbols(gainers)).toEqual(['G1', 'G2', 'G3']);
    expect(symbols(losers)).toEqual(['L4', 'L3', 'L2']);
  });
});
