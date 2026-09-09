// Confirms each provider surfaces the API response's token usage on
// TurnResult (via extract-usage.ts) — what portfolio-ai/index.ts sums across
// turns to estimate cost (see _shared/pricing.ts). Same style as
// tool-choice.test.ts: a stubbed fetch, asserting on the provider's parsed
// return value rather than a live call.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "./groq.ts";
import { OpenRouterProvider } from "./openrouter.ts";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GroqProvider.runTurn usage", () => {
  it("maps the response's usage field onto TurnResult", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
        }),
      ),
    );
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    const result = await provider.runTurn("openai/gpt-oss-20b", "system", []);
    expect(result.usage).toEqual({ promptTokens: 200, completionTokens: 50 });
  });

  it("leaves usage undefined when the response has none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] })));
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    const result = await provider.runTurn("openai/gpt-oss-20b", "system", []);
    expect(result.usage).toBeUndefined();
  });
});

describe("OpenRouterProvider.runTurn usage", () => {
  it("maps the response's usage field onto TurnResult", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 90, completion_tokens: 10 },
        }),
      ),
    );
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const result = await provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []);
    expect(result.usage).toEqual({ promptTokens: 90, completionTokens: 10 });
  });

  it("leaves usage undefined when the free-tier response reports usage as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        jsonResponse({ choices: [{ message: { content: "ok" } }], usage: null }),
      ),
    );
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    const result = await provider.runTurn("nvidia/nemotron-3-ultra-550b-a55b:free", "system", []);
    expect(result.usage).toBeUndefined();
  });
});
