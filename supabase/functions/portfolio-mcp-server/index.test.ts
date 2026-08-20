// Protocol-level test for the MCP server's JSON-RPC dispatch, covering the
// paths that don't require a live Supabase connection (tools/list, unknown
// method, unsupported HTTP verb). Tool execution against real data is
// exercised manually against a deployed instance — see
// docs/llm-mcp-agent-plan.md's testing section — since it needs the actual
// project's DB credentials, not something safe to fake here.
import { beforeAll, describe, expect, it, vi } from "vitest";

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (_key: string) => undefined },
    serve: (h: (req: Request) => Promise<Response> | Response) => {
      handler = h;
    },
  });
  await import("./index.ts");
});

function rpcRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/portfolio-mcp-server", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("portfolio-mcp-server", () => {
  it("responds to initialize with server info", async () => {
    const res = await handler(rpcRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("portfolio-mcp-server");
  });

  it("lists all registered tools with name/description/inputSchema", async () => {
    const res = await handler(rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_portfolio_summary",
        "list_holdings",
        "get_exposure_by_geography",
        "get_exposure_by_category",
        "get_concentration_risk",
        "get_risk_metrics",
        "run_stress_test",
        "check_limit_breaches",
        "compare_to_benchmark",
        "get_exposure_drift",
      ]),
    );
    for (const tool of body.result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("returns a JSON-RPC error for tools/call with an unknown tool name", async () => {
    const res = await handler(
      rpcRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "not_a_real_tool", arguments: {} } }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
  });

  it("advertises readOnlyHint annotations for every tool", async () => {
    const res = await handler(rpcRequest({ jsonrpc: "2.0", id: 20, method: "tools/list" }));
    const body = await res.json();
    for (const tool of body.result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it("rejects tools/call with a value below the schema's declared minimum, without silently substituting a default", async () => {
    const res = await handler(
      rpcRequest({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "get_concentration_risk", arguments: { topN: -3 } },
      }),
    );
    const body = await res.json();
    // Rejected as a tool-level error (isError), not a JSON-RPC protocol
    // error — same shape as any other tool failure.
    expect(body.result.isError).toBe(true);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.error).toMatch(/topN.*>= 1/);
  });

  it("rejects tools/call missing a required argument", async () => {
    const res = await handler(
      rpcRequest({
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: { name: "run_stress_test", arguments: {} },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.error).toMatch(/Missing required argument: shockPercent/);
  });

  it("rejects tools/call with a wrong-typed argument", async () => {
    const res = await handler(
      rpcRequest({
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: { name: "run_stress_test", arguments: { shockPercent: "twenty percent" } },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.error).toMatch(/shockPercent.*must be a number/);
  });

  it("rejects tools/call with an unexpected extra argument", async () => {
    const res = await handler(
      rpcRequest({
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: { name: "get_portfolio_summary", arguments: { unexpectedField: true } },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.error).toMatch(/Unexpected argument\(s\): unexpectedField/);
  });

  it("returns a JSON-RPC error for an unknown method", async () => {
    const res = await handler(rpcRequest({ jsonrpc: "2.0", id: 4, method: "bogus/method" }));
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("returns 202 with no body for a lone notification", async () => {
    const res = await handler(rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("rejects GET requests since no server-push stream is offered", async () => {
    const res = await handler(new Request("https://example.com/portfolio-mcp-server", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});
