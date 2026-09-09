// Persists one row per portfolio-ai chat request into public.llm_requests —
// the request-level counterpart to audit-log.ts's per-tool-call audit_logs
// rows (migration 20260909120000_add_llm_requests_and_request_id.sql).
//
// Correlated by request_id: this row's own `id` is the same uuid stamped
// onto every audit_logs row (via mcp-client.ts's `requestId` param) and
// every app_logs row (via db-log-sink.ts's request_id extraction) this
// chat request produced — DevZone's "Requests" tab joins on it to
// reconstruct one full trace per chat turn instead of matching timestamps
// by eye across three independent tables.
//
// Deliberately best-effort, same posture as audit-log.ts: a failure to
// write this row must never break the actual chat response it's describing.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { Logger } from "./logger.ts";

export interface LlmRequestRecord {
  requestId: string;
  /** The calling end user's auth.users id — always known here (portfolio-ai
   * requires an authenticated user before this point), unlike audit-log.ts's
   * optional `actor`. */
  actor: string;
  provider: string;
  model: string;
  modelPreference: string;
  status: "success" | "error";
  escalated: boolean;
  openRouterFallback: boolean;
  forcedGroundingRetryUsed: boolean;
  toolCallCount: number;
  durationMs: number;
  suspiciousInput: boolean;
  outputGuardrailTriggered: boolean;
  /** Token usage and estimated cost are intentionally absent here — no
   * provider response `usage` field is read yet (see groq.ts/openrouter.ts).
   * A follow-up change adds prompt_tokens/completion_tokens/
   * estimated_cost_usd; the columns already exist (same migration) and stay
   * null until then. */
  error?: string;
}

export async function recordLlmRequest(sb: SupabaseClient, logger: Logger, record: LlmRequestRecord): Promise<void> {
  try {
    const { error } = await sb.from("llm_requests").insert({
      id: record.requestId,
      actor: record.actor,
      provider: record.provider,
      model: record.model,
      model_preference: record.modelPreference,
      status: record.status,
      escalated: record.escalated,
      open_router_fallback: record.openRouterFallback,
      forced_grounding_retry_used: record.forcedGroundingRetryUsed,
      tool_call_count: record.toolCallCount,
      duration_ms: record.durationMs,
      suspicious_input: record.suspiciousInput,
      output_guardrail_triggered: record.outputGuardrailTriggered,
      error: record.error ?? null,
    });
    if (error) logger.warn("Failed to write llm_requests row", { requestId: record.requestId, error: error.message });
  } catch (err) {
    logger.warn("Failed to write llm_requests row", { requestId: record.requestId, error: err });
  }
}
