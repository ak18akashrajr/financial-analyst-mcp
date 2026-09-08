// Confirms each provider actually serializes the `toolChoice` param onto the
// wire, in that provider's own API shape — the mechanism the
// forced-grounding-retry guard in portfolio-ai/index.ts depends on (see
// tool-grounding-gate.test.ts) to make a "call a tool now" instruction
// API-enforced rather than just requested in a nudge. Groq/OpenRouter are
// OpenAI-compatible (a plain "auto"/"required" string); Anthropic uses its
// own {type: "auto" | "any"} shape.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "./groq.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenRouterProvider } from "./openrouter.ts";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GroqProvider.runTurn tool_choice", () => {
  it("defaults to \"auto\" when not passed", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", []);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toBe("auto");
  });

  it("sends \"required\" when explicitly forced", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GroqProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", [], "required");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toBe("required");
  });
});

describe("OpenRouterProvider.runTurn tool_choice", () => {
  it("defaults to \"auto\" when not passed", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", []);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toBe("auto");
  });

  it("sends \"required\" when explicitly forced", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", [], "required");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toBe("required");
  });
});

describe("AnthropicProvider.runTurn tool_choice", () => {
  it("defaults to {type: \"auto\"} when not passed", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ content: [{ type: "text", text: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", []);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toEqual({ type: "auto" });
  });

  it("sends {type: \"any\"} when explicitly forced (Anthropic's own \"required\" equivalent)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ content: [{ type: "text", text: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key");
    provider.addUserMessage("hi");

    await provider.runTurn("model", "system", [], "required");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tool_choice).toEqual({ type: "any" });
  });
});
