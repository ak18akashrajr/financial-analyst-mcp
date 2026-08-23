// Covers createSseStream's event framing and — the security-relevant part —
// that a thrown error's real message is never sent to the client (see
// docs/security-review.md finding #5: raw provider error text was being
// relayed verbatim, e.g. "Anthropic request failed: 401 ..."). The real
// error must still reach the caller's logger via the onError callback.
// Classification of *which* safe message a given error maps to (429 vs.
// 503 vs. network, etc.) is unit-tested in chat-error-classifier.test.ts;
// this file only checks createSseStream wires that classifier in correctly
// and still never leaks the raw error.
import { describe, expect, it, vi } from "vitest";
import { chunkText, createSseStream } from "./sse.ts";
import { HttpCallError } from "./http-call-error.ts";

async function readAllEvents(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("createSseStream", () => {
  it("frames each send() call as a well-formed SSE event", async () => {
    const stream = createSseStream(async (send) => {
      send("delta", { text: "hello" });
      send("done", { attribution: "Test" });
    });
    const text = await readAllEvents(stream);
    expect(text).toContain('event: delta\ndata: {"text":"hello"}\n\n');
    expect(text).toContain('event: done\ndata: {"attribution":"Test"}\n\n');
  });

  it("never leaks the real error message to the client on failure", async () => {
    const stream = createSseStream(async () => {
      throw new Error("Anthropic request failed: 401 {\"error\":\"invalid api key: sk-ant-abc123\"}");
    });
    const text = await readAllEvents(stream);
    expect(text).not.toContain("sk-ant-abc123");
    expect(text).not.toContain("401");
    expect(text).toContain("event: error");
  });

  it("still reports the real error to the caller's onError callback", async () => {
    const onError = vi.fn();
    const boom = new Error("Anthropic request failed: 401 secret-detail");
    const stream = createSseStream(async () => {
      throw boom;
    }, onError);
    await readAllEvents(stream);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("sends a specific rate-limited message for a 429 HttpCallError, not the flat generic message", async () => {
    const stream = createSseStream(async () => {
      throw new HttpCallError("Groq", 429, "rate limit exceeded");
    });
    const text = await readAllEvents(stream);
    expect(text).toMatch(/high volume of requests/i);
    expect(text).not.toContain("429");
    expect(text).not.toContain("Groq");
  });

  it("sends a specific unavailable message for a 503 HttpCallError, distinct from the rate-limited message", async () => {
    const stream = createSseStream(async () => {
      throw new HttpCallError("Anthropic", 503, "overloaded");
    });
    const text = await readAllEvents(stream);
    expect(text).toMatch(/temporarily unavailable/i);
    expect(text).not.toMatch(/high volume of requests/i);
  });
});

describe("chunkText", () => {
  it("splits text into whitespace-preserving chunks", () => {
    const chunks = [...chunkText("one two three four five six", 2)];
    expect(chunks.join("")).toBe("one two three four five six");
    expect(chunks.length).toBeGreaterThan(1);
  });
});
