// Real MCP (Model Context Protocol) server for the portfolio tools.
//
// Implements the MCP "Streamable HTTP" transport in its simplest valid form:
// a single POST endpoint accepting JSON-RPC 2.0 requests, responding with a
// single JSON body (no server-to-client push / resumable streams, since none
// of our tools need to send unsolicited messages — each tool call is a quick
// read-only DB query with a bounded response).
//
// This hand-rolls the JSON-RPC dispatch instead of depending on
// @modelcontextprotocol/sdk's transport classes, which are built around
// Node's http.IncomingMessage/ServerResponse and don't map cleanly onto a
// stateless Deno `fetch`-style edge function. The protocol surface itself
// (initialize, tools/list, tools/call, JSON-RPC error shape) follows the MCP
// spec directly, so any standard MCP client can talk to this endpoint.
//
// Access control: this function is only meant to be called by our own
// portfolio-ai edge function, authenticated the same way as any other
// Supabase Edge Function call (Authorization: Bearer <anon-or-service key>,
// enforced by the platform). No additional OAuth layer is implemented here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { findTool, TOOL_REGISTRY } from "../_shared/mcp-tools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-session-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function handleRpc(req: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "portfolio-mcp-server", version: "1.0.0" },
      });

    case "notifications/initialized":
      // Client notification, no id, no response expected.
      return null;

    case "ping":
      return rpcResult(req.id, {});

    case "tools/list":
      return rpcResult(req.id, {
        tools: TOOL_REGISTRY.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = String(req.params?.name || "");
      const args = (req.params?.arguments as Record<string, unknown>) || {};
      const tool = findTool(name);
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      try {
        const sb = getSupabaseClient();
        const result = await tool.handler(args, sb);
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify({ error: message }) }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    // No server-initiated SSE stream is offered — every response is a plain
    // JSON reply to a client-initiated POST.
    return new Response(JSON.stringify({ error: "GET not supported; use POST with a JSON-RPC body" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sessionId = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  const responseHeaders = { ...corsHeaders, "Content-Type": "application/json", "Mcp-Session-Id": sessionId };

  if (Array.isArray(body)) {
    const results = (await Promise.all(body.map((r) => handleRpc(r)))).filter((r) => r !== null);
    // All-notifications batch → no content per JSON-RPC 2.0 spec.
    if (results.length === 0) return new Response(null, { status: 202, headers: responseHeaders });
    return new Response(JSON.stringify(results), { headers: responseHeaders });
  }

  const result = await handleRpc(body);
  // A lone notification (e.g. notifications/initialized) gets no body.
  if (result === null) return new Response(null, { status: 202, headers: responseHeaders });
  return new Response(JSON.stringify(result), { headers: responseHeaders });
});
