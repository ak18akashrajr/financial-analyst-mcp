// Unit tests for checkRateLimit() — backs portfolio-ai's per-user rate
// limit (security-review.md finding #2). Uses a minimal fake Supabase
// client rather than a real one; the fixed-window arithmetic and the
// insert-vs-update branch are what's under test here, not Supabase itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS } from "./rate-limit.ts";

function fakeSupabase(existingCount: number | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existingCount == null ? null : { request_count: existingCount }, error: null });

  const from = vi.fn().mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
    insert,
    update,
  });

  return { from, insert, update, maybeSingle } as unknown as { from: typeof from; insert: typeof insert; update: typeof update };
}

describe("checkRateLimit", () => {
  it("allows the first request in a window and records it", async () => {
    const sb = fakeSupabase(null);
    const allowed = await checkRateLimit(sb as any, "user-1");
    expect(allowed).toBe(true);
    expect(sb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", request_count: 1 }),
    );
  });

  it("allows a request under the cap and increments the counter", async () => {
    const sb = fakeSupabase(RATE_LIMIT_MAX_REQUESTS - 1);
    const allowed = await checkRateLimit(sb as any, "user-1");
    expect(allowed).toBe(true);
    expect(sb.update).toHaveBeenCalledWith(
      expect.objectContaining({ request_count: RATE_LIMIT_MAX_REQUESTS }),
    );
  });

  it("rejects once the window's request count has reached the cap", async () => {
    const sb = fakeSupabase(RATE_LIMIT_MAX_REQUESTS);
    const allowed = await checkRateLimit(sb as any, "user-1");
    expect(allowed).toBe(false);
    expect(sb.update).not.toHaveBeenCalled();
  });
});
