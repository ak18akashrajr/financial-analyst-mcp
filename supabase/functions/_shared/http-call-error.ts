// Thrown by every outbound HTTP call this backend makes to an upstream
// service (an LLM provider, or our own portfolio-mcp-server) that returned a
// non-2xx response. Carries the real status code/body as typed fields
// instead of embedding them in a formatted message string, so a catcher can
// classify what actually went wrong (rate limited vs. temporarily down vs.
// a bad request) via `instanceof` + `.status` — see chat-error-classifier.ts
// — rather than regex-parsing a string built for logging, not for parsing.
//
// The status/body are for server-side logging only. Nothing that reads this
// error should ever forward `.status` or `.body` to an end user — see
// docs/security-review.md finding #5 for why (an upstream error body can
// contain infrastructure detail, e.g. a request id or masked key fragment).
export class HttpCallError extends Error {
  readonly source: string;
  readonly status: number;
  readonly body: string;

  constructor(source: string, status: number, body: string) {
    super(`${source} request failed: ${status} ${body}`);
    this.name = "HttpCallError";
    this.source = source;
    this.status = status;
    this.body = body;
  }
}
