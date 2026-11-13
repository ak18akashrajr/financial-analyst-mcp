import { describe, expect, it } from 'vitest';
import { pickRefreshRange } from '@/lib/dailyPriceRefresh';

describe('pickRefreshRange', () => {
  const today = '2026-11-13';

  it('uses the smallest range that reaches the oldest latest-bar among held symbols', () => {
    expect(pickRefreshRange(['A'], { A: '2026-11-12' }, today)).toBe('5d');
    expect(pickRefreshRange(['A'], { A: '2026-11-09' }, today)).toBe('5d'); // 4 days
    expect(pickRefreshRange(['A'], { A: '2026-11-06' }, today)).toBe('1mo'); // 7 days
    expect(pickRefreshRange(['A'], { A: '2026-10-06' }, today)).toBe('3mo'); // 38 days
    expect(pickRefreshRange(['A'], { A: '2026-07-01' }, today)).toBe('6mo'); // 135 days
    expect(pickRefreshRange(['A'], { A: '2026-01-01' }, today)).toBe('1y'); // 316 days
    expect(pickRefreshRange(['A'], { A: '2024-01-01' }, today)).toBe('2y');
  });

  it('is sized by the most lagging symbol', () => {
    expect(pickRefreshRange(['A', 'B'], { A: '2026-11-12', B: '2026-09-01' }, today)).toBe('3mo');
  });

  it('falls back to 2y when any held symbol has no stored bars', () => {
    expect(pickRefreshRange(['A', 'B'], { A: '2026-11-12' }, today)).toBe('2y');
    expect(pickRefreshRange(['A'], {}, today)).toBe('2y');
  });

  it('treats a latest bar dated after today (clock skew) as zero gap', () => {
    expect(pickRefreshRange(['A'], { A: '2026-11-14' }, today)).toBe('5d');
  });
});
