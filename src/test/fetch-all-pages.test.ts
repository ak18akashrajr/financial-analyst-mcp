// Unit tests for fetchAllPages (range-paging helper for PostgREST's silent 1,000-row cap).
import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, PAGE_SIZE } from '@/lib/fetchAllPages';

/** A fake table that honours `.range(from, to)` the way PostgREST does (inclusive bounds). */
function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  return vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
}

describe('fetchAllPages', () => {
  it('returns a single short page without a second request', async () => {
    const page = fakeTable(10);
    const { data, error } = await fetchAllPages(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(10);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith(0, PAGE_SIZE - 1);
  });

  it('reads past the 1,000-row cap, in order and without duplicates', async () => {
    const page = fakeTable(2_350);
    const { data } = await fetchAllPages(page);
    expect(data).toHaveLength(2_350);
    expect(data!.map(r => r.i)).toEqual(Array.from({ length: 2_350 }, (_, i) => i));
    expect(page).toHaveBeenCalledTimes(3); // 1000 + 1000 + 350
  });

  it('asks for one extra (empty) page when the row count is an exact multiple of the page size', async () => {
    const page = fakeTable(2_000);
    const { data } = await fetchAllPages(page);
    expect(data).toHaveLength(2_000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array for an empty table', async () => {
    const { data, error } = await fetchAllPages(fakeTable(0));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('treats a null data payload as no rows', async () => {
    const { data } = await fetchAllPages(async () => ({ data: null, error: null }));
    expect(data).toEqual([]);
  });

  it('is all-or-nothing: a mid-stream page error yields null data, never a truncated list', async () => {
    let calls = 0;
    const { data, error } = await fetchAllPages(async (from, to) => {
      calls++;
      if (calls === 2) return { data: null, error: { message: 'boom' } };
      return { data: Array.from({ length: to - from + 1 }, (_, i) => ({ i: from + i })), error: null };
    });
    expect(error).toEqual({ message: 'boom' });
    expect(data).toBeNull();
  });

  it('gives up with an error rather than looping forever if the query ignores .range()', async () => {
    const full = Array.from({ length: 1_000 }, (_, i) => ({ i }));
    const { data, error } = await fetchAllPages(async () => ({ data: full, error: null }));
    expect(error?.message).toMatch(/exceeded/);
    expect(data).toBeNull();
  });

  it('honours a custom page size', async () => {
    const page = fakeTable(25);
    const { data } = await fetchAllPages(page, 10);
    expect(data).toHaveLength(25);
    expect(page).toHaveBeenCalledTimes(3);
  });
});
