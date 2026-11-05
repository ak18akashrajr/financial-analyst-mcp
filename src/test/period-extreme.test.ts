import { describe, expect, it } from 'vitest';
import { periodExtreme } from '@/lib/periodReports';

describe('periodExtreme', () => {
  const pts = [
    { key: 'Q1', pct: 5 },
    { key: 'Q2', pct: -8 },
    { key: 'Q3', pct: 12 },
    { key: 'Q4', pct: null },
  ];

  it('labels the top-ranked period as best when it is a gain', () => {
    expect(periodExtreme('Q3', pts)).toEqual({ kind: 'best', pct: 12 });
  });

  it('labels the bottom-ranked period as worst when it is a loss', () => {
    expect(periodExtreme('Q2', pts)).toEqual({ kind: 'worst', pct: -8 });
  });

  it('returns null for a period in the middle of the ranking', () => {
    expect(periodExtreme('Q1', pts)).toBeNull();
  });

  it('returns null when the active period has no real growth figure', () => {
    expect(periodExtreme('Q4', pts)).toBeNull();
  });

  it('returns null when fewer than two periods can be ranked', () => {
    expect(periodExtreme('Q1', [{ key: 'Q1', pct: 5 }])).toBeNull();
    expect(periodExtreme('Q1', [{ key: 'Q1', pct: 5 }, { key: 'Q2', pct: null }])).toBeNull();
  });

  it('returns null when the active period is not among the completed periods', () => {
    expect(periodExtreme('Q9', pts)).toBeNull();
  });

  it('does not label a tie for the top spot as best', () => {
    const tied = [{ key: 'A', pct: 10 }, { key: 'B', pct: 10 }, { key: 'C', pct: -1 }];
    expect(periodExtreme('A', tied)).toBeNull();
    expect(periodExtreme('B', tied)).toBeNull();
  });

  it('does not label a tie for the bottom spot as worst', () => {
    const tied = [{ key: 'A', pct: -4 }, { key: 'B', pct: -4 }, { key: 'C', pct: 3 }];
    expect(periodExtreme('A', tied)).toBeNull();
  });

  it('does not call a top period "best" when even the top period is a loss', () => {
    const allDown = [{ key: 'A', pct: -1 }, { key: 'B', pct: -5 }];
    expect(periodExtreme('A', allDown)).toBeNull();
    expect(periodExtreme('B', allDown)).toEqual({ kind: 'worst', pct: -5 });
  });

  it('does not call a bottom period "worst" when even the bottom period is a gain', () => {
    const allUp = [{ key: 'A', pct: 2 }, { key: 'B', pct: 7 }];
    expect(periodExtreme('A', allUp)).toBeNull();
    expect(periodExtreme('B', allUp)).toEqual({ kind: 'best', pct: 7 });
  });
});
