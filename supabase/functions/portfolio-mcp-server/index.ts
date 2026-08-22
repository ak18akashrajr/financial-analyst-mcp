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
// Access control: this function is internal-only — meant to be called by
// our own portfolio-ai edge function, never directly by the frontend. It
// reads the full portfolio via the service-role key (bypassing RLS), so
// admission is not left to the platform's `verify_jwt` alone (that check
// accepts the public anon key too, which anyone can read out of the client
// bundle). Instead this function requires the caller's bearer token to be
// the actual service-role key, which never leaves the server — see
// requireServiceRole() below. portfolio-ai is the only holder of that key
// and is itself responsible for verifying the real end user before it
// forwards a call here (see _shared/auth.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { findTool, TOOL_REGISTRY } from "../_shared/mcp-tools.ts";
import { validateArgs } from "../_shared/mcp-schema-validate.ts";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { recordToolCall } from "../_shared/audit-log.ts";

const logger = createLogger("portfolio-mcp-server");

const corsHeaders = buildCorsHeaders(
  "mcp-session-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
);

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

/** True only if `req`'s bearer token is the actual service-role secret —
 * i.e. the caller is portfolio-ai itself, not a client holding just the
 * public anon key. Constant-time comparison to avoid a timing side channel
 * on the secret. */
function requestHasServiceRole(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!token || !serviceRoleKey || token.length !== serviceRoleKey.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ serviceRoleKey.charCodeAt(i);
  return diff === 0;
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
          annotations: t.annotations,
        })),
      });

    case "tools/call": {
      const name = String(req.params?.name || "");
      const args = (req.params?.arguments as Record<string, unknown>) || {};
      // Optional caller identity, forwarded by portfolio-ai from the real
      // end user's session (see McpClient.callTool) — separate from
      // `arguments` so it never has to pass the tool's own strict
      // inputSchema validation below. Purely for the audit trail; not used
      // for any access-control decision (this endpoint's admission check is
      // requestHasServiceRole, above).
      const actor = typeof req.params?.actor === "string" ? req.params.actor : undefined;
      const tool = findTool(name);
      if (!tool) {
        logger.warn("Unknown tool requested", { name });
        return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      }
      // Enforce the tool's declared inputSchema before the handler runs, so
      // it's a real contract rather than advertising in tools/list — a
      // client passing a bad value (e.g. a negative topN) gets rejected
      // instead of a silently-substituted default and a misleading success.
      const validationError = validateArgs(tool.inputSchema, args);
      if (validationError) {
        logger.warn("Invalid tool arguments", { tool: name, error: validationError });
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify({ error: validationError }) }],
          isError: true,
        });
      }
      const startedAt = Date.now();
      const sb = getSupabaseClient();
      try {
        const result = await tool.handler(args, sb);
        const duration_ms = Date.now() - startedAt;
        logger.info("Tool call succeeded", { tool: name, duration_ms });
        await recordToolCall(sb, logger, { tool: name, actor, args, durationMs: duration_ms, success: true });
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed";
        const duration_ms = Date.now() - startedAt;
        logger.error("Tool call failed", { tool: name, duration_ms, error: err });
        await recordToolCall(sb, logger, {
          tool: name,
          actor,
          args,
          durationMs: duration_ms,
          success: false,
          error: message,
        });
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

  if (!requestHasServiceRole(req)) {
    logger.warn("Rejected non-service-role request to portfolio-mcp-server");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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
