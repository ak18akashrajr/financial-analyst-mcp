// Bounded-concurrency helper for fanning out independent async work (e.g. a
// single LLM turn requesting several MCP tool calls at once). Plain
// `Promise.all` would fire every item at the same instant with no ceiling —
// fine for 2-3 tool calls, but a turn that requests many independent lookups
// would otherwise slam portfolio-mcp-server (and the Postgres connections
// behind it) with one burst. `mapWithConcurrency` runs at most `limit` items
// at a time while preserving the input order in the returned array,
// regardless of which item finishes first.

/**
 * Maps `items` through `fn`, running at most `limit` calls concurrently.
 * Results are returned in the same order as `items`, not completion order.
 *
 * Rejection semantics match `Promise.all`: the first `fn` rejection rejects
 * the whole call. Callers that need per-item failures to become data (rather
 * than aborting the batch) should catch inside `fn` and resolve with an
 * error-shaped value instead — see portfolio-ai/index.ts's tool-call loop for
 * that pattern.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
