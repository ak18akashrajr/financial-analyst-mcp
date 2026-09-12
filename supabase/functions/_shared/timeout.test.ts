import { describe, expect, it, vi } from "vitest";
import { CallTimeoutError, withTimeout } from "./timeout.ts";
import { isRetryableError } from "./retry.ts";

/** Real (very short) timers rather than fake ones: these assertions are about
 * which side of the race settles first, and a handful of millisecond sleeps
 * keeps that ordering genuine without making the suite slow. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withTimeout", () => {
  it("returns fn's value when it settles inside the deadline", async () => {
    await expect(withTimeout(async () => "done", 200, "fast call")).resolves.toBe("done");
  });

  it("rejects with CallTimeoutError once the deadline passes", async () => {
    const hang = () => new Promise<never>(() => {});
    await expect(withTimeout(hang, 20, "MCP tool get_risk_metrics")).rejects.toThrow(CallTimeoutError);
    await expect(withTimeout(hang, 20, "MCP tool get_risk_metrics")).rejects.toThrow(
      "MCP tool get_risk_metrics timed out after 20ms",
    );
  });

  it("propagates fn's own rejection unchanged when it loses the race", async () => {
    // The point of this case: a caller's existing error handling must keep
    // seeing the real upstream error, not have every failure flattened into
    // a timeout.
    await expect(
      withTimeout(async () => {
        throw new Error("upstream failure");
      }, 200, "failing call"),
    ).rejects.toThrow("upstream failure");
  });

  it("clears its timer on the fast path, so a finished call leaves nothing pending", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await withTimeout(async () => "done", 5_000, "fast call");
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
    // Belt-and-braces: if the 5s timer were still armed, an unhandled
    // rejection would surface after this test finished rather than here.
    await sleep(5);
  });

  it("rejects a non-positive or non-finite timeout instead of racing forever", async () => {
    await expect(withTimeout(async () => 1, 0, "bad")).rejects.toThrow(/positive finite number/);
    await expect(withTimeout(async () => 1, -100, "bad")).rejects.toThrow(/positive finite number/);
    await expect(withTimeout(async () => 1, Number.NaN, "bad")).rejects.toThrow(/positive finite number/);
    await expect(withTimeout(async () => 1, Number.POSITIVE_INFINITY, "bad")).rejects.toThrow(
      /positive finite number/,
    );
  });

  it("is NOT classified as retryable by retry.ts", () => {
    // Guards the naming decision documented in timeout.ts: naming this
    // "TimeoutError" (or "AbortError") would make isTimeout() match it, so a
    // deadline we set ourselves would get retried with backoff — extending
    // the very latency the timeout exists to bound.
    const err = new CallTimeoutError("MCP tool list_holdings", 15_000);
    expect(err.name).toBe("CallTimeoutError");
    expect(isRetryableError(err)).toBe(false);
  });

  it("carries the configured budget on the error for logging", () => {
    expect(new CallTimeoutError("x", 15_000).timeoutMs).toBe(15_000);
  });
});
