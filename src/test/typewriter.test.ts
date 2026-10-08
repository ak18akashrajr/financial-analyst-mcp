import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypewriter, revealBoundary } from '@/lib/typewriter';

describe('revealBoundary', () => {
  it('snaps forward to the end of the current word', () => {
    expect(revealBoundary('hello wonderful world', 8)).toBe(15); // mid "wonderful" -> its end
    expect(revealBoundary('hello world', 5)).toBe(5); // already on whitespace
  });

  it('returns the full length when the position is at or past the end, or no whitespace follows', () => {
    expect(revealBoundary('abc', 10)).toBe(3);
    expect(revealBoundary('abcdef', 2)).toBe(6);
  });

  it('reveals a markdown table block whole instead of one half-rendered row at a time', () => {
    const text = 'Intro\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter the table';
    const insideTable = text.indexOf('| 1') + 2;
    expect(revealBoundary(text, insideTable)).toBe(text.indexOf('After'));
  });
});

describe('createTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => vi.useRealTimers());

  const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');

  it('shows everything immediately when animation is disabled (reduced motion)', async () => {
    const seen: string[] = [];
    const tw = createTypewriter((t) => seen.push(t), false);
    tw.push('Hello ');
    tw.push('world');
    expect(seen.at(-1)).toBe('Hello world');
    await expect(tw.drained()).resolves.toBeUndefined();
  });

  it('reveals progressively, never ahead of what was pushed, and finishes on the full text', async () => {
    const seen: string[] = [];
    const tw = createTypewriter((t) => seen.push(t), true);
    tw.push(longText);
    let done = false;
    tw.drained().then(() => (done = true));

    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(3);
    const partial = seen.at(-1)!;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(longText.length);
    expect(longText.startsWith(partial)).toBe(true);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.at(-1)).toBe(longText);
    expect(done).toBe(true);
    // monotonic: each emission extends the previous one
    for (let i = 1; i < seen.length; i++) expect(seen[i].startsWith(seen[i - 1])).toBe(true);
  });

  it('keeps going when more text arrives mid-reveal', async () => {
    const seen: string[] = [];
    const tw = createTypewriter((t) => seen.push(t), true);
    tw.push('first part of the answer ');
    await vi.advanceTimersByTimeAsync(50);
    tw.push('and the second part');
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.at(-1)).toBe('first part of the answer and the second part');
  });

  it('finishNow reveals everything pushed so far and settles drained()', async () => {
    const seen: string[] = [];
    const tw = createTypewriter((t) => seen.push(t), true);
    tw.push(longText);
    const drained = tw.drained();
    tw.finishNow();
    expect(seen.at(-1)).toBe(longText);
    await expect(drained).resolves.toBeUndefined();
  });

  it('cancel stops emitting and still settles waiters', async () => {
    const seen: string[] = [];
    const tw = createTypewriter((t) => seen.push(t), true);
    tw.push(longText);
    const drained = tw.drained();
    tw.cancel();
    const count = seen.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBe(count);
    await expect(drained).resolves.toBeUndefined();
  });
});
