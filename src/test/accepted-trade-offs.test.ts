// Guards the Dev Zone "Trade-offs" register (src/lib/acceptedTradeOffs.ts) so an entry can't be added
// half-filled, duplicated, or filed under an area the tab doesn't render (which would hide it).
import { describe, expect, it } from 'vitest';
import { ACCEPTED_TRADE_OFFS, TRADE_OFF_AREAS } from '@/lib/acceptedTradeOffs';

describe('accepted trade-offs register', () => {
  it('has unique, slug-shaped ids', () => {
    const ids = ACCEPTED_TRADE_OFFS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('fills in every field of every entry', () => {
    for (const t of ACCEPTED_TRADE_OFFS) {
      for (const key of ['title', 'tradeOff', 'whyAccepted', 'impact', 'revisitWhen', 'source'] as const) {
        expect(t[key].trim().length, `${t.id}.${key}`).toBeGreaterThan(20);
      }
      expect(t.acceptedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('files every entry under an area the tab renders', () => {
    for (const t of ACCEPTED_TRADE_OFFS) expect(TRADE_OFF_AREAS).toContain(t.area);
    for (const area of TRADE_OFF_AREAS) {
      expect(ACCEPTED_TRADE_OFFS.some((t) => t.area === area), area).toBe(true);
    }
  });

  it('keeps a fixed trade-off in the register, marked resolved, instead of deleting it', () => {
    const boundary = ACCEPTED_TRADE_OFFS.find((t) => t.id === 'reports-period-end-boundary')!;
    expect(boundary.resolvedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(boundary.resolvedOn! >= boundary.acceptedOn).toBe(true);
  });
});
