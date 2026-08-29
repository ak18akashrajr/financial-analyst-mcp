import { describe, it, expect } from 'vitest';
import { getDynamicGreeting } from '@/lib/greeting';

describe('getDynamicGreeting', () => {
  it('returns a Monday morning message', () => {
    // Monday 2026-08-31 08:00 local
    const monday = new Date(2026, 7, 31, 8, 0, 0);
    const greeting = getDynamicGreeting(monday);
    expect(greeting.title).toContain('Ak');
    expect(greeting.subtitle).not.toBe('');
    expect(greeting.emoji).toBeTruthy();
  });

  it('returns a Friday evening message', () => {
    // Friday 2026-09-04 19:00 local
    const fridayEvening = new Date(2026, 8, 4, 19, 0, 0);
    const greeting = getDynamicGreeting(fridayEvening);
    expect(greeting.title.toLowerCase()).toMatch(/weekend/);
  });

  it('falls back to a generic period message for days without a curated entry', () => {
    // Tuesday evening has no curated bank entry -> falls back by period.
    const tuesdayEvening = new Date(2026, 8, 1, 20, 0, 0);
    const greeting = getDynamicGreeting(tuesdayEvening);
    expect(greeting.title).toContain('Evening debrief');
  });

  it('appends a positive stat line when totalPnlPercent and xirr are provided', () => {
    // xirr is a decimal fraction (matches PortfolioSummary.xirr / XirrDetailsCard), not a percentage.
    const now = new Date(2026, 7, 31, 8, 0, 0);
    const greeting = getDynamicGreeting(now, { totalPnlPercent: 12.345, xirr: 0.182 });
    expect(greeting.subtitle).toContain('+12.3%');
    expect(greeting.subtitle).toContain('18.2% XIRR');
  });

  it('appends a negative stat line without XIRR when only totalPnlPercent is provided', () => {
    const now = new Date(2026, 7, 31, 8, 0, 0);
    const greeting = getDynamicGreeting(now, { totalPnlPercent: -4.2, xirr: null });
    expect(greeting.subtitle).toContain('-4.2%');
    expect(greeting.subtitle).toContain('down');
  });

  it('omits the stat line when no stats are provided', () => {
    const now = new Date(2026, 7, 31, 8, 0, 0);
    const withoutStats = getDynamicGreeting(now);
    expect(withoutStats.subtitle).not.toMatch(/XIRR|Book's/);
  });
});
