// Confirms portfolio-ai's opt-in OpenRouter path (docs/openrouter-nemotron-plan.md):
// modelPreference validation, Anthropic still winning outright over a
// user-selected OpenRouter model, quota-exhausted falling back to Groq, and
// an OpenRouter HttpCallError falling back to Groq mid-turn. The provider
// files' own runTurn/HTTP behavior is unit-tested in
// _shared/providers/provider-error.test.ts and the quota arithmetic in
// _shared/openrouter-quota.test.ts; this only checks index.ts wires them
// together correctly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpCallError as HttpCallErrorType } from "../_shared/http-call-error.ts";

vi.mock("../_shared/auth.ts", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("../_shared/rate-limit.ts", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  RATE_LIMIT_MAX_REQUESTS: 10,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.100.1", () => ({
  createClient: () => ({}),
}));

vi.mock("../_shared/mcp-client.ts", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
  })),
}));

const quotaMock = vi.fn();
vi.mock("../_shared/openrouter-quota.ts", () => ({
  checkAndIncrementQuota: quotaMock,
  NEMOTRON_MODEL_ID: "nvidia/nemotron-3-ultra-550b-a55b:free",
  MINIMAX_MODEL_ID: "minimax/minimax-m2.7:free",
  OPENROUTER_MODEL_ATTRIBUTION: {
    "nvidia/nemotron-3-ultra-550b-a55b:free": "NVIDIA Nemotron 3 Ultra via OpenRouter",
    "minimax/minimax-m2.7:free": "MiniMax M2.7 via OpenRouter",
  },
}));

const openRouterRunTurnMock = vi.fn();
vi.mock("../_shared/providers/openrouter.ts", () => ({
  OpenRouterProvider: vi.fn().mockImplementation(() => ({
    name: "openrouter",
    loadHistory: vi.fn(),
    addUserMessage: vi.fn(),
    appendToolResults: vi.fn(),
    runTurn: openRouterRunTurnMock,
  })),
}));

const groqRunTurnMock = vi.fn();
vi.mock("../_shared/providers/groq.ts", () => ({
  GroqProvider: vi.fn().mockImplementation(() => ({
    name: "groq",
    loadHistory: vi.fn(),
    addUserMessage: vi.fn(),
    appendToolResults: vi.fn(),
    runTurn: groqRunTurnMock,
  })),
}));

const anthropicRunTurnMock = vi.fn();
vi.mock("../_shared/providers/anthropic.ts", () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    name: "anthropic",
    loadHistory: vi.fn(),
    addUserMessage: vi.fn(),
    appendToolResults: vi.fn(),
    runTurn: anthropicRunTurnMock,
  })),
}));

let handler: (req: Request) => Promise<Response> | Response;
let HttpCallError: typeof HttpCallErrorType;

function stubEnv(vars: Record<string, string>) {
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => vars[key] },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
}

beforeEach(async () => {
  vi.resetModules();
  quotaMock.mockReset();
  openRouterRunTurnMock.mockReset();
  groqRunTurnMock.mockReset();
  anthropicRunTurnMock.mockReset();
});

function chatRequest(modelPreference?: string): Request {
  return new Request("https://example.com/portfolio-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], modelPreference }),
  });
}

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

describe("portfolio-ai modelPreference validation", () => {
  it("rejects an unrecognized modelPreference with a 400, before any provider is built", async () => {
    stubEnv({ GROQ_API_KEY: "test-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    const res = await handler(chatRequest("not-a-real-model"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/modelPreference must be one of/);
  });
});

describe("portfolio-ai opt-in OpenRouter routing", () => {
  it("uses the requested OpenRouter model when the key is set and quota allows", async () => {
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    quotaMock.mockResolvedValue(true);
    openRouterRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("nemotron"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(quotaMock).toHaveBeenCalledWith(expect.anything(), "nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(openRouterRunTurnMock).toHaveBeenCalledTimes(1);
    expect(groqRunTurnMock).not.toHaveBeenCalled();
    expect(text).toContain("NVIDIA Nemotron 3 Ultra via OpenRouter");
  });

  it("falls back to Groq without calling OpenRouter when ANTHROPIC_API_KEY is set (Anthropic wins outright)", async () => {
    stubEnv({ ANTHROPIC_API_KEY: "anthropic-key", GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    anthropicRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("nemotron"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(quotaMock).not.toHaveBeenCalled();
    expect(anthropicRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("Claude Sonnet 5");
  });

  it("falls back to Groq, with an honest attribution note, when OPENROUTER_API_KEY is not configured", async () => {
    stubEnv({ GROQ_API_KEY: "test-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("minimax"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(quotaMock).not.toHaveBeenCalled();
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("event: done");
  });

  it("falls back to Groq, with an honest attribution note, when the model's daily quota is exhausted", async () => {
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    quotaMock.mockResolvedValue(false);
    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("minimax"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(openRouterRunTurnMock).not.toHaveBeenCalled();
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/daily quota is used up for today/);
  });

  it("falls back to Groq mid-turn when the OpenRouter call itself fails with a retryable HttpCallError", async () => {
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    quotaMock.mockResolvedValue(true);
    openRouterRunTurnMock.mockRejectedValue(new HttpCallError("OpenRouter", 429, "rate limited"));
    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("nemotron"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(openRouterRunTurnMock).toHaveBeenCalledTimes(1);
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("OpenRouter fallback");
    expect(text).not.toContain("429");
  });

  it("falls back to Groq mid-turn when the OpenRouter call times out (not just an HttpCallError)", async () => {
    // Real production case (2026-08-30): nemotron sometimes never responds at
    // all — openrouter.ts now bounds that with its own request timeout, which
    // surfaces here as a DOMException, not an HttpCallError. The fallback
    // must still trigger on this, not just on an HTTP error status.
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    quotaMock.mockResolvedValue(true);
    openRouterRunTurnMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("nemotron"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(openRouterRunTurnMock).toHaveBeenCalledTimes(1);
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("OpenRouter fallback");
  });

  it("falls back to Groq on a LATER turn's OpenRouter failure too, not just the first", async () => {
    // Real production case (2026-08-30): Nemotron succeeded on turn 0 (asked
    // for a tool call) but failed on turn 1 with a genuine upstream 502 — the
    // fallback used to only trigger on turn 0, so this surfaced as a raw
    // classified error instead of falling back to Groq.
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    quotaMock.mockResolvedValue(true);
    openRouterRunTurnMock
      .mockResolvedValueOnce({ done: false, calls: [{ id: "call-1", name: "get_portfolio_summary", arguments: {} }] })
      .mockRejectedValueOnce(new HttpCallError("OpenRouter", 502, "upstream overloaded"));
    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest("nemotron"));
    const text = await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(openRouterRunTurnMock).toHaveBeenCalledTimes(2);
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("OpenRouter fallback");
  });

  it("never calls OpenRouter at all when modelPreference is omitted (auto stays today's behavior)", async () => {
    stubEnv({ GROQ_API_KEY: "test-key", OPENROUTER_API_KEY: "or-key" });
    ({ HttpCallError } = await import("../_shared/http-call-error.ts"));
    await import("./index.ts");

    groqRunTurnMock.mockResolvedValue({ done: true, text: "answer" });

    const res = await handler(chatRequest());
    await readAllEvents(res.body as ReadableStream<Uint8Array>);

    expect(quotaMock).not.toHaveBeenCalled();
    expect(openRouterRunTurnMock).not.toHaveBeenCalled();
    expect(groqRunTurnMock).toHaveBeenCalledTimes(1);
  });
});
