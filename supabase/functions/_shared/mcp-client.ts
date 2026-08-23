// Minimal MCP client used by portfolio-ai to talk to portfolio-mcp-server
// over real JSON-RPC 2.0 (Streamable HTTP, single-response mode) — this is
// the genuine client/server boundary: portfolio-ai never imports the tool
// handlers directly, only their static complexity metadata (see mcp-tools.ts
// header comment). Every tool execution is a real network round trip.

import { HttpCallError } from "./http-call-error.ts";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  private serverUrl: string;
  private authHeader: string;
  private nextId = 1;

  constructor(serverUrl: string, authHeader: string) {
    this.serverUrl = serverUrl;
    this.authHeader = authHeader;
  }

  private async rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const res = await fetch(this.serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpCallError(`MCP server ${method}`, res.status, text);
    }
    const body = await res.json();
    if (body.error) throw new Error(`MCP error (${method}): ${body.error.message}`);
    return body.result;
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "portfolio-ai", version: "1.0.0" },
    });
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.rpc("tools/list")) as { tools: McpToolDef[] };
    return result.tools;
  }

  /** Calls a tool and returns its parsed JSON result (or throws if the tool reported isError).
   * `actor` (the calling end user's id) is optional and purely for the
   * server's audit trail — it's a sibling of `arguments`, not part of it, so
   * it never has to pass the tool's own inputSchema validation. */
  async callTool(name: string, args: Record<string, unknown>, actor?: string): Promise<unknown> {
    const result = (await this.rpc("tools/call", { name, arguments: args, actor })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    const text = result.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    if (result.isError) throw new Error(parsed.error || `Tool ${name} failed`);
    return parsed;
  }
}
