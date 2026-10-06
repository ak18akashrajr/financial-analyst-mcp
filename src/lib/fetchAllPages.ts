/**
 * Reads every row of a Supabase query by paging with `.range()`.
 *
 * PostgREST caps a single response at 1,000 rows (supabase/config.toml has no `max_rows`
 * override), and the cap is silent: a plain `.select()` over a bigger table just returns the first
 * 1,000 rows in query order, with no error. For `transactions` that means the oldest rows vanish and
 * FIFO / XIRR / tax / holdings are all wrong; for `historical_prices` it truncates series.
 *
 * `fetchPage` must build a fresh query each call and apply `.range(from, to)` to it. The query MUST
 * have a deterministic order that includes a unique tie-break column (e.g. `.order('date').order('id')`)
 * — ties on a non-unique sort key can skip or duplicate rows across page boundaries.
 *
 * Returns the same `{ data, error }` shape as a plain query so each call site keeps its own error
 * handling (log vs throw). It is all-or-nothing, like a plain query: if any page fails, `data` is null
 * and `error` is set — a half-read list is never returned, because a truncated transaction or price
 * history silently produces wrong numbers. A page cap stops a misbehaving query (one that ignores
 * `.range()`) from looping forever.
 *
 * The Deno edge functions have a line-for-line copy in supabase/functions/_shared/paginate.ts — keep
 * the two in sync.
 */
export const PAGE_SIZE = 1000;
const MAX_PAGES = 500; // 500k rows — far past anything this single-user app will hold

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<PageResult<T>> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
  return { data: null, error: { message: `fetchAllPages: exceeded ${MAX_PAGES} pages` } };
}
