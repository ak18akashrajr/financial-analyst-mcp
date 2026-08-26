import { describe, expect, it, vi } from "vitest";
import { HttpCallError } from "./http-call-error.ts";
import { isRetryableError, withRetry } from "./retry.ts";

describe("isRetryableError", () => {
  it("is true for the rate-limited/upstream-unavailable HttpCallError statuses", () => {
    for (const status of [429, 500, 502, 503, 504, 529]) {
      expect(isRetryableError(new HttpCallError("Test", status, "body"))).toBe(true);
    }
  });

  it("is false for an HttpCallError status that means the request itself is wrong", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryableError(new HttpCallError("Test", status, "body"))).toBe(false);
    }
  });

  it("is true for a timeout (AbortError/TimeoutError by name, not instanceof Error)", () => {
    expect(isRetryableError({ name: "AbortError" })).toBe(true);
    expect(isRetryableError({ name: "TimeoutError" })).toBe(true);
  });

  it("is true for a fetch()-level network failure (TypeError, no status at all)", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("is false for a plain application error (e.g. a JSON-RPC error field)", () => {
    expect(isRetryableError(new Error("MCP error (tools/call): boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn, { label: "Test", sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a retryable failure and returns the eventual success", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpCallError("Test", 503, "unavailable"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { label: "Test", sleep });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stops after maxAttempts and throws the last error", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const err = new HttpCallError("Test", 429, "rate limited");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { label: "Test", maxAttempts: 3, sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // one sleep between each pair of attempts
  });

  it("does not retry a non-retryable error — fails on the first attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const err = new HttpCallError("Test", 400, "bad request");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { label: "Test", sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors a custom isRetryable predicate instead of the default classification", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const err = new Error("custom transient error");
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { label: "Test", sleep, isRetryable: () => true });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially, capped at maxDelayMs, before jitter", async () => {
    const delays: number[] = [];
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    const err = new HttpCallError("Test", 503, "unavailable");
    const fn = vi.fn().mockRejectedValue(err);

    // Pin jitter to "always the cap" so the sequence is deterministic.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      await expect(
        withRetry(fn, { label: "Test", sleep, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 350 }),
      ).rejects.toBe(err);
    } finally {
      randomSpy.mockRestore();
    }

    // attempt 1 -> 100, attempt 2 -> 200, attempt 3 -> capped at 350 (would be 400 uncapped)
    expect(delays).toEqual([100, 200, 350]);
  });
});
