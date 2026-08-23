// Covers every status code classifyChatError is documented to handle, plus
// the non-HTTP failure modes (network, timeout, tool-loop-exceeded,
// unknown) — and the security property that matters most: none of the
// returned messages ever contain the real status code, response body, or
// provider name (see docs/security-review.md finding #5).
import { describe, expect, it } from "vitest";
import { classifyChatError, ToolLoopExceededError } from "./chat-error-classifier.ts";
import { HttpCallError } from "./http-call-error.ts";

const SECRET_BODY = '{"error":"invalid api key: sk-ant-abc123"}';

describe("classifyChatError", () => {
  it("classifies 429 as rate_limited with a 429 suggested status", () => {
    const result = classifyChatError(new HttpCallError("Anthropic", 429, SECRET_BODY));
    expect(result.category).toBe("rate_limited");
    expect(result.httpStatus).toBe(429);
    expect(result.message).toMatch(/high volume of requests/i);
  });

  it("classifies 413 as payload_too_large", () => {
    const result = classifyChatError(new HttpCallError("Groq", 413, ""));
    expect(result.category).toBe("payload_too_large");
    expect(result.httpStatus).toBe(413);
    expect(result.message).toMatch(/too long/i);
  });

  it.each([400, 422])("classifies %i as bad_request", (status) => {
    const result = classifyChatError(new HttpCallError("Groq", status, ""));
    expect(result.category).toBe("bad_request");
    expect(result.httpStatus).toBe(400);
  });

  it.each([401, 403, 404])("classifies %i (our own misconfiguration) as upstream_unavailable, never surfaced as an auth problem", (status) => {
    const result = classifyChatError(new HttpCallError("Anthropic", status, SECRET_BODY));
    expect(result.category).toBe("upstream_unavailable");
    expect(result.httpStatus).toBe(503);
    expect(result.message).toMatch(/temporarily unavailable/i);
  });

  it.each([408, 504])("classifies %i as timeout", (status) => {
    const result = classifyChatError(new HttpCallError("Groq", status, ""));
    expect(result.category).toBe("timeout");
    expect(result.httpStatus).toBe(504);
  });

  it.each([500, 502, 503, 529])("classifies %i (including Anthropic's overloaded_error 529) as upstream_unavailable", (status) => {
    const result = classifyChatError(new HttpCallError("Anthropic", status, ""));
    expect(result.category).toBe("upstream_unavailable");
    expect(result.httpStatus).toBe(503);
  });

  it("classifies an unlisted 4xx as bad_request", () => {
    const result = classifyChatError(new HttpCallError("Groq", 418, ""));
    expect(result.category).toBe("bad_request");
  });

  it("classifies a fetch-level network failure (TypeError) as network", () => {
    const result = classifyChatError(new TypeError("error sending request for url"));
    expect(result.category).toBe("network");
    expect(result.httpStatus).toBe(503);
  });

  it("classifies an AbortError as timeout", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    const result = classifyChatError(err);
    expect(result.category).toBe("timeout");
  });

  it("classifies ToolLoopExceededError distinctly from other internal errors", () => {
    const result = classifyChatError(new ToolLoopExceededError("Tool loop exceeded the maximum number of turns"));
    expect(result.category).toBe("tool_loop_exceeded");
    expect(result.httpStatus).toBe(500);
    expect(result.message).toMatch(/more analysis steps/i);
  });

  it("falls back to unknown for a plain Error with no HttpCallError/typed marker", () => {
    const result = classifyChatError(new Error("Anthropic request failed: 401 " + SECRET_BODY));
    expect(result.category).toBe("unknown");
    expect(result.httpStatus).toBe(500);
  });

  it("falls back to unknown for a non-Error thrown value", () => {
    expect(classifyChatError("boom").category).toBe("unknown");
    expect(classifyChatError(undefined).category).toBe("unknown");
  });

  it("never includes the real status code, response body, or provider name in any returned message", () => {
    const statuses = [400, 401, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504, 529, 418];
    for (const status of statuses) {
      const { message } = classifyChatError(new HttpCallError("Anthropic", status, SECRET_BODY));
      expect(message).not.toContain("sk-ant-abc123");
      expect(message).not.toContain("Anthropic");
      expect(message).not.toContain(String(status));
    }
  });
});
