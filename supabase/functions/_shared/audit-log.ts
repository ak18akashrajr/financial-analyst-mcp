// Persistent audit trail for portfolio-mcp-server tool calls (security-review.md
// addendum, second audit 2026-08-22). Complements _shared/logger.ts rather than
// replacing it: the logger's stdout lines are for live tailing in Supabase's log
// explorer and roll off retention; this table is for "what did the AI agent do,
// and when" after the fact.
//
// Deliberately best-effort: a failure to write an audit row must never break
// the actual tool call it's describing, so every failure is caught and only
// warn-logged, never rethrown.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { Logger } from "./logger.ts";

export interface ToolCallRecord {
  tool: string;
  /** The calling end user's auth.users id, when known — see mcp-client.ts's
   * optional `actor` param. Undefined for a caller that doesn't supply one. */
  actor?: string;
  args: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  error?: string;
}

export async function recordToolCall(sb: SupabaseClient, logger: Logger, record: ToolCallRecord): Promise<void> {
  try {
    const { error } = await sb.from("audit_logs").insert({
      actor: record.actor ?? null,
      tool_name: record.tool,
      arguments: record.args,
      duration_ms: record.durationMs,
      success: record.success,
      error: record.error ?? null,
    });
    if (error) logger.warn("Failed to write audit log row", { tool: record.tool, error: error.message });
  } catch (err) {
    logger.warn("Failed to write audit log row", { tool: record.tool, error: err });
  }
}
