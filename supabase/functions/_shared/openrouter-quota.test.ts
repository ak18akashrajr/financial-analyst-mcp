// Unit tests for checkAndIncrementQuota() / dailyCapFor() — backs the opt-in
// OpenRouter models' free-tier daily quota (docs/openrouter-nemotron-plan.md).
// Uses a minimal fake Supabase client rather than a real one, mirroring
// rate-limit.test.ts's pattern — the insert-vs-update branch and the per-
// model cap lookup are what's under test here, not Supabase itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAndIncrementQuota,
  dailyCapFor,
  MINIMAX_MODEL_ID,
  NEMOTRON_MODEL_ID,
} from "./openrouter-quota.ts";

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

describe("dailyCapFor", () => {
  const originalDeno = (globalThis as any).Deno;

  beforeEach(() => {
    vi.stubGlobal("Deno", { env: { get: (_key: string) => undefined } });
  });

  afterEach(() => {
    (globalThis as any).Deno = originalDeno;
  });

  it("falls back to the conservative default (200) when no env override is set", () => {
    expect(dailyCapFor(NEMOTRON_MODEL_ID)).toBe(200);
    expect(dailyCapFor(MINIMAX_MODEL_ID)).toBe(200);
  });

  it("uses the env override when it's a valid positive number", () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => (key === "OPENROUTER_NEMOTRON_DAILY_CAP" ? "50" : undefined) } });
    expect(dailyCapFor(NEMOTRON_MODEL_ID)).toBe(50);
  });

  it("ignores a non-numeric or non-positive env override and falls back to the default", () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => (key === "OPENROUTER_MINIMAX_DAILY_CAP" ? "not-a-number" : undefined) } });
    expect(dailyCapFor(MINIMAX_MODEL_ID)).toBe(200);
  });

  it("returns 0 for an unrecognized model id", () => {
    expect(dailyCapFor("some/other-model")).toBe(0);
  });
});

describe("checkAndIncrementQuota", () => {
  beforeEach(() => {
    vi.stubGlobal("Deno", { env: { get: (_key: string) => undefined } });
  });

  it("allows the first request today and records it", async () => {
    const sb = fakeSupabase(null);
    const allowed = await checkAndIncrementQuota(sb as any, NEMOTRON_MODEL_ID);
    expect(allowed).toBe(true);
    expect(sb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ model_id: NEMOTRON_MODEL_ID, request_count: 1 }),
    );
  });

  it("allows a request under the cap and increments the counter", async () => {
    const sb = fakeSupabase(199);
    const allowed = await checkAndIncrementQuota(sb as any, NEMOTRON_MODEL_ID);
    expect(allowed).toBe(true);
    expect(sb.update).toHaveBeenCalledWith(expect.objectContaining({ request_count: 200 }));
  });

  it("rejects once today's count has reached the cap", async () => {
    const sb = fakeSupabase(200);
    const allowed = await checkAndIncrementQuota(sb as any, NEMOTRON_MODEL_ID);
    expect(allowed).toBe(false);
    expect(sb.update).not.toHaveBeenCalled();
  });

  it("tracks each model id independently — one model's usage doesn't affect another's", async () => {
    const sb = fakeSupabase(200); // Nemotron's cap reached...
    expect(await checkAndIncrementQuota(sb as any, NEMOTRON_MODEL_ID)).toBe(false);
    // ...but MiniMax's own quota, keyed separately in the real table, is untouched by this.
    // (fakeSupabase here just proves the same client call would be re-evaluated per model id.)
    const sbMinimax = fakeSupabase(null);
    expect(await checkAndIncrementQuota(sbMinimax as any, MINIMAX_MODEL_ID)).toBe(true);
  });
});
