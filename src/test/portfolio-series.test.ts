import { describe, expect, it } from 'vitest';
import {
  buildValueSeries,
  detectGranularity,
  flowAdjustedReturns,
  periodsPerYear,
  type PricesBySymbol,
  type SeriesTransaction,
} from '@/lib/portfolioSeries';

const buy = (symbol: string, date: string, quantity: number, price: number): SeriesTransaction => ({
  symbol,
  type: 'BUY',
  quantity,
  price,
  date,
});

const sell = (symbol: string, date: string, quantity: number, price: number): SeriesTransaction => ({
  symbol,
  type: 'SELL',
  quantity,
  price,
  date,
});

const bars = (entries: [string, number][]) => entries.map(([date, close]) => ({ date, close }));

describe('buildValueSeries', () => {
  it('marks holdings to market on every date that has a price row', () => {
    const txns = [buy('A', '2026-01-01', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-05', 90]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    expect(series.points.map((p) => p.value)).toEqual([1000, 1100, 900]);
  });

  it('carries the last close forward for a symbol with no bar on a grid date', () => {
    // B trades on the 2nd but not the 5th; its 2nd-of-Jan close must still be used on the 5th
    // rather than dropping B out of the portfolio's value entirely.
    const txns = [buy('A', '2026-01-01', 1, 100), buy('B', '2026-01-01', 1, 50)];
    const prices: PricesBySymbol = {
      A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-05', 100]]),
      B: bars([['2026-01-01', 50], ['2026-01-02', 60]]),
    };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([150, 160, 160]);
    expect(series.points.every((p) => p.complete)).toBe(true);
  });

  it('drops a holding from value once it is fully sold', () => {
    const txns = [buy('A', '2026-01-01', 10, 100), sell('A', '2026-01-02', 10, 110)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-03', 120]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 0, 0]);
  });

  it('includes a transaction dated on a grid date despite its timestamptz suffix', () => {
    // transactions.date is timestamptz: a raw lexicographic compare would place
    // "2026-01-02T10:30:00+00:00" after "2026-01-02" and push the buy to the next bar.
    const txns = [buy('A', '2026-01-02T10:30:00+00:00', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-02', 100], ['2026-01-03', 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points[0].date).toBe('2026-01-02');
    expect(series.points[0].value).toBe(1000);
  });

  it('attributes a trade made on a non-trading day to the next bar', () => {
    // 2026-01-03 is a Saturday — there is no bar for it, so the buy shows up on Monday the 5th.
    const txns = [buy('A', '2026-01-01', 10, 100), buy('A', '2026-01-03', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-05', 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 1000, 2000]);
    expect(series.points.map((p) => p.netFlow)).toEqual([1000, 0, 1000]);
  });

  it('flags a point as incomplete while a held symbol has no price yet', () => {
    // B is bought on the 1st but has no price row until the 3rd. Value on the 1st and 2nd
    // understates the portfolio, so those points must not feed the return series.
    const txns = [buy('A', '2026-01-01', 1, 100), buy('B', '2026-01-01', 1, 500)];
    const prices: PricesBySymbol = {
      A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100]]),
      B: bars([['2026-01-03', 500]]),
    };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.complete)).toEqual([false, false, true]);
    expect(series.incompletePoints).toBe(2);
    expect(series.symbolsWithoutPrices).toEqual(['B']);
  });

  it('honours an explicit endDate', () => {
    const txns = [buy('A', '2026-01-01', 1, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-05', 100]]) };

    const series = buildValueSeries(txns, prices, { endDate: '2026-01-02' });

    expect(series.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('returns an empty series with no transactions, and with no price data', () => {
    expect(buildValueSeries([], { A: bars([['2026-01-01', 100]]) }).points).toEqual([]);
    expect(buildValueSeries([buy('A', '2026-01-01', 1, 100)], {}).points).toEqual([]);
  });

  it('ignores price rows predating the first transaction', () => {
    const txns = [buy('A', '2026-01-05', 1, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 80], ['2026-01-05', 100]]) };

    expect(buildValueSeries(txns, prices).points.map((p) => p.date)).toEqual(['2026-01-05']);
  });
});

describe('flowAdjustedReturns', () => {
  it('reports a zero return on a pure contribution day with no market move', () => {
    // THE case this whole module exists for: ₹1,000 held, ₹1,000 added, price unchanged.
    // Naive (V1 − V0)/V0 would read +100%; the true market return is 0%.
    const txns = [buy('A', '2026-01-01', 10, 100), buy('A', '2026-01-02', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 2000]);
    expect(flowAdjustedReturns(series)).toEqual([0]);
  });

  it('separates the market move from the contribution on a day with both', () => {
    // Day 1: 10 @ ₹100 = ₹1,000. Day 2: price 110 (+₹100 market) and 10 more bought @ ₹110
    // (+₹1,100 flow) → V1 = 2,200. r = (2200 − 1000 − 1100) / 1000 = 0.10, the price move alone.
    const txns = [buy('A', '2026-01-01', 10, 100), buy('A', '2026-01-02', 10, 110)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 110]]) };

    expect(flowAdjustedReturns(buildValueSeries(txns, prices))).toEqual([0.1]);
  });

  it('reports a zero return on a pure withdrawal day with no market move', () => {
    const txns = [buy('A', '2026-01-01', 10, 100), sell('A', '2026-01-02', 4, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 600]);
    expect(series.points[1].netFlow).toBe(-400);
    expect(flowAdjustedReturns(series)).toEqual([0]);
  });

  it('computes a plain price return when there is no flow', () => {
    const txns = [buy('A', '2026-01-01', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-03', 99]]) };

    const returns = flowAdjustedReturns(buildValueSeries(txns, prices));

    expect(returns[0]).toBeCloseTo(0.1, 12);
    expect(returns[1]).toBeCloseTo(-0.1, 12);
  });

  it('skips pairs touching an incomplete point instead of reading the jump as a return', () => {
    // B becomes priceable on the 3rd, adding ₹500 of value that is not a market move.
    const txns = [buy('A', '2026-01-01', 1, 100), buy('B', '2026-01-01', 1, 500)];
    const prices: PricesBySymbol = {
      A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100], ['2026-01-04', 110]]),
      B: bars([['2026-01-03', 500], ['2026-01-04', 500]]),
    };

    const series = buildValueSeries(txns, prices);

    // Only the 3rd→4th pair survives: A moves 100→110 on a ₹600 base, so (610 − 600 − 0) / 600.
    // The ₹500 of B appearing on the 3rd is never seen as a return by either surviving endpoint.
    const returns = flowAdjustedReturns(series);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(10 / 600, 12);
  });

  it('skips a pair starting from a zero value rather than dividing by it', () => {
    const txns = [buy('A', '2026-01-01', 10, 100), sell('A', '2026-01-02', 10, 100), buy('A', '2026-01-03', 10, 100)];
    const prices: PricesBySymbol = { A: bars([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100]]) };

    const series = buildValueSeries(txns, prices);

    expect(series.points.map((p) => p.value)).toEqual([1000, 0, 1000]);
    // 1st→2nd is a full exit (flow −1,000, so r = 0); 2nd→3rd starts from 0 and is skipped.
    expect(flowAdjustedReturns(series)).toEqual([0]);
  });
});

describe('detectGranularity', () => {
  it('classifies consecutive trading days as daily', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
    expect(detectGranularity(dates).granularity).toBe('daily');
  });

  it('classifies month-end rows as monthly', () => {
    const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'];
    expect(detectGranularity(dates).granularity).toBe('monthly');
  });

  it('is unknown with fewer than 3 dates', () => {
    expect(detectGranularity(['2026-01-01', '2026-01-02']).granularity).toBe('unknown');
  });
});

describe('periodsPerYear', () => {
  it('annualizes daily data by 252 trading days and monthly data by 12', () => {
    expect(periodsPerYear('daily')).toBe(252);
    expect(periodsPerYear('monthly')).toBe(12);
  });

  it('derives a factor from the observed spacing for a mixed grid', () => {
    expect(periodsPerYear('mixed', 7)).toBeCloseTo(365 / 7, 10);
  });
});

describe('buildValueSeries granularity reporting', () => {
  it('reports monthly spacing so callers annualize by 12, not 252', () => {
    const txns = [buy('A', '2026-01-31', 10, 100)];
    const prices: PricesBySymbol = {
      A: bars([['2026-01-31', 100], ['2026-02-28', 105], ['2026-03-31', 110], ['2026-04-30', 108]]),
    };

    const series = buildValueSeries(txns, prices);

    expect(series.granularity).toBe('monthly');
    expect(series.periodsPerYear).toBe(12);
  });
});
