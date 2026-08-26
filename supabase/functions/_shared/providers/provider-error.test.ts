// Confirms both LLM providers throw the typed HttpCallError (carrying the
// real status code) on a non-ok HTTP response, rather than an untyped Error
// with the status embedded only in a formatted message string — that's what
// lets chat-error-classifier.ts classify the failure via `instanceof` +
// `.status` instead of regex-parsing a log-oriented string. See
// chat-error-classifier.test.ts for the classification itself, and
// retry.test.ts for the backoff/retry mechanics in isolation — this file
// only checks that runTurn's fetch is actually wrapped in it, via fetch call
// counts under fake timers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "./groq.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { HttpCallError } from "../http-call-error.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GroqProvider.runTurn", () => {
  it("throws an HttpCallError with the real status once retries are exhausted", async () => {
    vi.useFakeTimers();
    // A fresh Response per call — a Response body can only be read once,
    // and runTurn awaits res.text() when building the error.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("rate limited", { status: 429 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    const pending = provider.runTurn("model", "system", []).catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(429);
    expect((caught as HttpCallError).source).toBe("Groq");
    // 429 is retryable — the default 3 attempts, not just 1.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable status (fails on the first attempt)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    await expect(provider.runTurn("model", "system", [])).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AnthropicProvider.runTurn", () => {
  it("throws an HttpCallError with the real status once retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("overloaded", { status: 529 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key");
    provider.addUserMessage("hi");

    const pending = provider.runTurn("model", "system", []).catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(529);
    expect((caught as HttpCallError).source).toBe("Anthropic");
    // 529 (Anthropic's overloaded status) is retryable — the default 3 attempts, not just 1.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable status (fails on the first attempt)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key");
    provider.addUserMessage("hi");

    await expect(provider.runTurn("model", "system", [])).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
