// Generic retry-with-exponential-backoff helper for outbound HTTP calls this
// backend makes to an upstream service (an LLM provider, or our own
// portfolio-mcp-server) — see groq.ts/anthropic.ts's runTurn and
// mcp-client.ts's rpc(). A transient failure (rate limited, momentarily
// overloaded, a network blip) used to fail the whole chat turn on the first
// try; this retries those specific cases a bounded number of times before
// giving up, while a genuinely bad request (400/401/403/404/413/422 — our
// bug or misconfiguration, not a blip) still fails immediately, since
// retrying it would just repeat the same failure.
//
// All calls this wraps are read-only (every MCP tool is backed by a SELECT —
// see mcp-tools.ts's header comment — and an LLM chat-completion call has no
// side effect of its own), so retrying is safe: there's no risk of a retry
// double-applying a write.
import { HttpCallError } from "./http-call-error.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("retry");

// Mirrors chat-error-classifier.ts's categoryForStatus, but narrower: only
// the statuses that categorizer buckets as rate_limited/upstream_unavailable
// are worth a retry. 400/401/403/404/413/422 are excluded on purpose — those
// mean the request itself (or our credentials/config) is wrong, and an
// identical retry fails identically.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

/** Same check as chat-error-classifier.ts's isTimeout — a cancelled/timed-out
 * fetch surfaces as a DOMException named AbortError/TimeoutError, not an
 * Error subclass, so this checks `.name` directly. */
function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * True for the transient cases worth retrying: a rate limit or upstream
 * outage status, a timeout, or a fetch()-level network failure (DNS,
 * connection refused, TLS — surfaces as a TypeError in both Deno and
 * browsers, with no status code at all). Everything else — including any
 * non-HttpCallError application error (e.g. a JSON-RPC `error` field, or a
 * tool reporting `isError`) — is treated as non-retryable by default.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpCallError) return RETRYABLE_STATUSES.has(err.status);
  if (isTimeout(err)) return true;
  if (err instanceof TypeError) return true;
  return false;
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3 (i.e. up to 2 retries). */
  maxAttempts?: number;
  /** Delay before the first retry, in ms; doubles each subsequent retry. Default 300. */
  baseDelayMs?: number;
  /** Ceiling applied to a delay before jitter. Default 4000. */
  maxDelayMs?: number;
  /** Overridable for tests; defaults to `isRetryableError`. */
  isRetryable?: (err: unknown) => boolean;
  /** Included in the retry log line, e.g. "Groq", "Anthropic", "MCP server tools/call". */
  label: string;
  /** Injectable sleep so tests don't wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying with exponential backoff + full jitter while the
 * thrown error is classified as transient by `isRetryable` and attempts
 * remain. A non-retryable error, or the final attempt's error, propagates to
 * the caller unchanged — same as if this wrapper weren't there.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 4000;
  const isRetryable = opts.isRetryable ?? isRetryableError;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;

      // Full jitter (0..cap), not a fixed delay — spreads out retries from
      // multiple concurrent callers (e.g. mapWithConcurrency's tool-call fan
      // out) instead of having them all wake up and hit the upstream again
      // at the same instant.
      const cap = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.random() * cap;
      logger.warn(`${opts.label} call failed, retrying`, {
        attempt,
        maxAttempts,
        delayMs: Math.round(delayMs),
        error: err,
      });
      await sleep(delayMs);
    }
  }
}
