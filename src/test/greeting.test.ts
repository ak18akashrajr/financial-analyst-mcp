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
});
