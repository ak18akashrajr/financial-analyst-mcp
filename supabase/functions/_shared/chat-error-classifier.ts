// Classifies a failure from portfolio-ai's chat pipeline (an LLM provider
// call, or our own portfolio-mcp-server call) into a small, fixed set of
// safe, specific, end-user-facing messages — instead of the one flat
// "Something went wrong" every failure used to collapse into regardless of
// cause. A 429 (rate limited — try again in a few seconds) and a 503
// (temporarily down — try again later) mean genuinely different things to
// someone waiting on an answer; this is what tells them apart.
//
// The messages below are the ONLY thing ever sent to the client. None of
// them interpolate the real status code, response body, or provider name —
// that would recreate exactly the leak docs/security-review.md finding #5
// fixed (an upstream error body can contain a request id or masked key
// fragment, and naming the vendor contradicts the system prompt's own
// "never reveal infrastructure/provider details" rule). The real error
// (with its real status/body) still reaches the server-side structured
// logger via the caller's own logging — see sse.ts's `onError` and
// portfolio-ai/index.ts's top-level catch — this module only decides which
// fixed message goes back over the wire.
import { HttpCallError } from "./http-call-error.ts";

export type ChatErrorCategory =
  | "rate_limited"
  | "payload_too_large"
  | "bad_request"
  | "upstream_unavailable"
  | "timeout"
  | "network"
  | "tool_loop_exceeded"
  | "unknown";

export interface ClassifiedChatError {
  category: ChatErrorCategory;
  /** Safe to send to the client as-is. */
  message: string;
  /** Suggested HTTP status if this needs to become an HTTP response (the
   * pre-stream path in portfolio-ai/index.ts's top-level catch). Unused by
   * the mid-stream SSE `error` event, which has no status of its own. */
  httpStatus: number;
}

/** Thrown by portfolio-ai/index.ts's own tool-call loop guard — distinct
 * from an upstream HTTP failure, so it gets its own message rather than
 * falling into the generic bucket. */
export class ToolLoopExceededError extends Error {}

const MESSAGES: Record<ChatErrorCategory, string> = {
  rate_limited: "The AI service is receiving a high volume of requests right now. Please wait a few seconds and try again.",
  payload_too_large: "This conversation has gotten too long for the AI to process. Please start a new chat.",
  bad_request: "The AI service couldn't process that request. Try rephrasing your question and asking again.",
  upstream_unavailable: "The AI service is temporarily unavailable. Please try again in a few minutes.",
  timeout: "The request took too long to complete. Please try again.",
  network: "Couldn't reach the AI service. Please check your connection and try again.",
  tool_loop_exceeded: "This question needed more analysis steps than expected to answer fully. Try asking something more specific.",
  unknown: "Something went wrong while generating a response. Please try again.",
};

/**
 * Maps an upstream HTTP status code to a category. Covers every status an
 * LLM provider or our own MCP server is realistically expected to return:
 *
 *   400 Bad Request           — malformed request to the provider (our bug, not the user's)
 *   401 Unauthorized           — invalid/expired credentials on our end (server misconfig)
 *   403 Forbidden               — credentials rejected/lack permission (server misconfig)
 *   404 Not Found                — wrong endpoint/model name (server misconfig)
 *   408 Request Timeout          — the provider gave up waiting on the request
 *   413 Payload Too Large        — conversation history too large for the provider to accept
 *   422 Unprocessable Entity     — request was well-formed but semantically invalid
 *   429 Too Many Requests        — rate limited (the exact case that motivated this fix)
 *   500 Internal Server Error    — the provider hit an internal error
 *   502 Bad Gateway               — the provider's own upstream is unreachable
 *   503 Service Unavailable      — the provider is down/overloaded/in maintenance
 *   504 Gateway Timeout           — the provider's upstream timed out
 *   529 (Anthropic-specific) "overloaded_error" — Anthropic's capacity-exceeded status
 *
 * 401/403/404 are genuinely OUR fault (bad key, wrong model name) but are
 * bucketed with the other "unavailable" statuses rather than a distinct
 * category — from the end user's side there's nothing they can do
 * differently for a misconfiguration vs. a real outage, and the true cause
 * must stay server-side (see the module doc comment above).
 */
function categoryForStatus(status: number): ChatErrorCategory {
  if (status === 429) return "rate_limited";
  if (status === 413) return "payload_too_large";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "bad_request";
  // 401/403/404 are configuration problems on our end (bad key, wrong model
  // name), not something malformed in the request itself — but see the doc
  // comment above for why they're still routed to the generic "unavailable"
  // message rather than "bad_request".
  if (status === 401 || status === 403 || status === 404) return "upstream_unavailable";
  if (status >= 500) return "upstream_unavailable"; // 500, 502, 503, 529, and any other 5xx
  if (status >= 400) return "bad_request"; // any other 4xx not explicitly listed above
  return "unknown"; // a non-ok status outside the 4xx/5xx range shouldn't happen, but don't guess
}

/**
 * A cancelled/timed-out fetch surfaces as an AbortError — but as a
 * DOMException, not an Error subclass (neither Deno's nor a browser's), so
 * this checks `.name` directly rather than gating on `instanceof Error`.
 */
function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

export function classifyChatError(err: unknown): ClassifiedChatError {
  if (err instanceof ToolLoopExceededError) {
    return { category: "tool_loop_exceeded", message: MESSAGES.tool_loop_exceeded, httpStatus: 500 };
  }
  if (err instanceof HttpCallError) {
    const category = categoryForStatus(err.status);
    return { category, message: MESSAGES[category], httpStatus: httpStatusFor(category) };
  }
  if (isTimeout(err)) {
    return { category: "timeout", message: MESSAGES.timeout, httpStatus: httpStatusFor("timeout") };
  }
  // A fetch()-level network failure (DNS, connection refused, TLS, etc.)
  // rather than an HTTP error response — fetch rejects with a TypeError in
  // this case (both in Deno and browsers), there's no status code at all.
  if (err instanceof TypeError) {
    return { category: "network", message: MESSAGES.network, httpStatus: httpStatusFor("network") };
  }
  return { category: "unknown", message: MESSAGES.unknown, httpStatus: 500 };
}

function httpStatusFor(category: ChatErrorCategory): number {
  switch (category) {
    case "rate_limited": return 429;
    case "payload_too_large": return 413;
    case "bad_request": return 400;
    case "timeout": return 504;
    case "upstream_unavailable": return 503;
    case "network": return 503;
    case "tool_loop_exceeded": return 500;
    case "unknown": return 500;
  }
}
