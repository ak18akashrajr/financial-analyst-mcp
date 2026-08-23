// Confirms both LLM providers throw the typed HttpCallError (carrying the
// real status code) on a non-ok HTTP response, rather than an untyped Error
// with the status embedded only in a formatted message string — that's what
// lets chat-error-classifier.ts classify the failure via `instanceof` +
// `.status` instead of regex-parsing a log-oriented string. See
// chat-error-classifier.test.ts for the classification itself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "./groq.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { HttpCallError } from "../http-call-error.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GroqProvider.runTurn", () => {
  it("throws an HttpCallError with the real status on a non-ok response", async () => {
    // A fresh Response per call — a Response body can only be read once,
    // and runTurn awaits res.text() when building the error.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("rate limited", { status: 429 }))));
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    let caught: unknown;
    try {
      await provider.runTurn("model", "system", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(429);
    expect((caught as HttpCallError).source).toBe("Groq");
  });
});

describe("AnthropicProvider.runTurn", () => {
  it("throws an HttpCallError with the real status on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("overloaded", { status: 529 }))));
    const provider = new AnthropicProvider("test-key");
    provider.addUserMessage("hi");

    let caught: unknown;
    try {
      await provider.runTurn("model", "system", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(529);
    expect((caught as HttpCallError).source).toBe("Anthropic");
  });
});
