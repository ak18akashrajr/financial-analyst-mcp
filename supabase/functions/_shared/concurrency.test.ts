import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.ts";

/** Resolves after a macrotask tick so overlapping calls actually overlap in
 * the test instead of resolving synchronously in submission order. */
function tick<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

describe("mapWithConcurrency", () => {
  it("returns an empty array for an empty input without calling fn", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 3, async () => {
      calls++;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("maps every item and preserves input order regardless of completion order", async () => {
    // Item 0 is the slowest and item 2 the fastest, so completion order is
    // reversed from input order — the result array must still be [0,1,2].
    const delays = [30, 15, 0];
    const result = await mapWithConcurrency([0, 1, 2], 3, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, delays[item]));
      return item * 10;
    });
    expect(result).toEqual([0, 10, 20]);
  });

  it("never runs more than `limit` calls concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(item);
      active--;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1); // proves it actually overlapped, not fully serial
  });

  it("runs everything concurrently when limit >= item count", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [0, 1, 2, 3];

    await mapWithConcurrency(items, 10, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(item);
      active--;
      return item;
    });

    expect(maxActive).toBe(4);
  });

  it("propagates the first rejection like Promise.all", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("item 2 failed");
        await tick(item);
        return item;
      }),
    ).rejects.toThrow("item 2 failed");
  });

  it("rejects synchronously for a non-positive or non-integer limit", async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow(/positive integer/);
    await expect(mapWithConcurrency([1], -1, async (x) => x)).rejects.toThrow(/positive integer/);
    await expect(mapWithConcurrency([1], 1.5, async (x) => x)).rejects.toThrow(/positive integer/);
  });
});
