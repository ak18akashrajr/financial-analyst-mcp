// Per-call wall-clock bound for outbound work this backend awaits.
//
// `retry.ts` already bounds how many times a transient failure is retried,
// but nothing bounded how long a single attempt could take: a request that
// connects and then never answers leaves the caller awaiting it forever. In
// portfolio-ai's tool-call loop that was doubly costly — `mapWithConcurrency`
// runs a fixed pool of workers, each doing `await fn(...)`, so one hung call
// doesn't just stall its own result, it parks a worker and stops the pool from
// picking up the remaining calls at all.
//
// Deliberately does NOT abort the underlying fetch. Aborting would surface as
// a DOMException named "AbortError", which `retry.ts`'s `isRetryableError`
// classifies as transient — so an abort fired from inside `McpClient.rpc`'s
// `withRetry` wrapper would be retried with backoff, extending the very
// latency the timeout exists to bound. Racing instead means the caller stops
// waiting on schedule; the abandoned request is left to finish (or not) on its
// own. Wiring real cancellation through would mean teaching `withRetry` to
// distinguish a deliberate abort from a network timeout, which affects the LLM
// provider paths too — out of scope here, and not needed to stop a hang from
// blocking a turn.

/** Thrown when `withTimeout`'s deadline wins the race.
 *
 * Named `CallTimeoutError`, NOT `TimeoutError`, on purpose: `retry.ts`'s
 * `isTimeout` matches on `.name === "AbortError" | "TimeoutError"`, so a
 * timeout named either of those would be silently reclassified as a transient
 * failure worth retrying if this error ever flowed through `withRetry`. A
 * deadline we set ourselves has already spent its budget — retrying it is
 * never what we want. */
export class CallTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "CallTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs `fn`, rejecting with `CallTimeoutError` if it hasn't settled within
 * `timeoutMs`. `label` names the call in that error's message (e.g.
 * `MCP tool get_risk_metrics`).
 *
 * `fn`'s own rejection always propagates unchanged when it loses the race, so
 * a caller's existing error handling keeps working; only the timeout case is
 * new. The pending timer is always cleared — including on the fast path — so a
 * short-lived Deno isolate is never held open by a timer for a call that
 * already finished.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`withTimeout: timeoutMs must be a positive finite number, got ${timeoutMs}`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CallTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
