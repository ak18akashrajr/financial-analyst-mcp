// Unit tests for McpClient — specifically that callTool forwards the
// optional `actor` param as a JSON-RPC sibling of `arguments` (used only for
// portfolio-mcp-server's audit trail; see audit-log.ts), rather than folding
// it into `arguments` where it would fail the tool's own inputSchema
// validation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient } from "./mcp-client.ts";
import { HttpCallError } from "./http-call-error.ts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("McpClient.callTool", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }], isError: false },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends actor as a sibling of arguments in the tools/call params", async () => {
    const client = new McpClient("https://example.com/portfolio-mcp-server", "Bearer test-key");
    await client.callTool("get_portfolio_summary", { topN: 5 }, "user-123");

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.params).toEqual({ name: "get_portfolio_summary", arguments: { topN: 5 }, actor: "user-123" });
  });

  it("omits actor cleanly when not supplied", async () => {
    const client = new McpClient("https://example.com/portfolio-mcp-server", "Bearer test-key");
    await client.callTool("list_holdings", {});

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.params.name).toBe("list_holdings");
    expect(body.params.actor).toBeUndefined();
  });
});

describe("McpClient non-ok HTTP response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a retryable status (503) up to the default attempt cap, then throws HttpCallError", async () => {
    vi.useFakeTimers();
    // A fresh Response per call — a Response body can only be read once,
    // and rpc() awaits res.text() when building the error.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("service unavailable", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new McpClient("https://example.com/portfolio-mcp-server", "Bearer test-key");

    const pending = client.initialize().catch((err) => err);
    await vi.runAllTimersAsync();
    const caught = await pending;

    expect(caught).toBeInstanceOf(HttpCallError);
    expect((caught as HttpCallError).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable status (400) — fails on the first attempt", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new McpClient("https://example.com/portfolio-mcp-server", "Bearer test-key");

    await expect(client.initialize()).rejects.toBeInstanceOf(HttpCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
