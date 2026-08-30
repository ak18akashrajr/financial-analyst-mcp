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
import { OPENROUTER_MAX_ATTEMPTS, OpenRouterProvider } from "./openrouter.ts";
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

describe("OpenRouterProvider.runTurn", () => {
  it("throws an HttpCallError with the real status once retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("rate limited", { status: 429 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const pending = provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []).catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(429);
    expect((caught as HttpCallError).source).toBe("OpenRouter");
    // 429 is retryable — OpenRouter's own reduced attempt cap (2), not just 1.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_ATTEMPTS);
  });

  it("does not retry a non-retryable status (fails on the first attempt)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    await expect(provider.runTurn("minimax/minimax-m2.7:free", "system", [])).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Real production failure (2026-08-30): nvidia/nemotron-3-ultra-550b-a55b:free
  // returned HTTP 200 with an error body instead of a completion — the code
  // used to crash with an unclassified "Cannot read properties of undefined
  // (reading '0')" TypeError instead of a proper HttpCallError, which meant
  // it never triggered the OpenRouter->Groq fallback in portfolio-ai/index.ts.
  it("throws a classified HttpCallError (not a raw TypeError) on an HTTP 200 with an error body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "no instances available", code: 503 } }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const pending = provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []).catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(503);
    // 503 is retryable — OpenRouter's own reduced attempt cap (2), not just 1.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_ATTEMPTS);
  });

  it("throws a classified HttpCallError on an HTTP 200 with no choices and no error field either", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const caught = await provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []).catch((err) => err);
    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(502); // no numeric error.code to use, so the generic default
  });

  // Real production case (2026-08-30): nemotron sometimes never responds at
  // all (no error, no timeout) rather than erroring — a silent, permanent
  // hang with no HTTP status to classify, since nothing ever comes back.
  it("passes an AbortSignal to fetch so a hung request doesn't wait forever", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries up to OpenRouter's own (reduced) attempt cap when the request times out", async () => {
    vi.useFakeTimers();
    // Simulates what fetch() actually rejects with once an AbortSignal.timeout
    // signal fires — a DOMException named "TimeoutError", which retry.ts's
    // isTimeout()/isRetryableError() already know how to classify.
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const pending = provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []).catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect((caught as DOMException).name).toBe("TimeoutError");
    // Fewer attempts than Groq/Anthropic's default 3 — a hung free-tier model
    // shouldn't compound into an even longer wait before falling back to Groq.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_ATTEMPTS);
  });
});
