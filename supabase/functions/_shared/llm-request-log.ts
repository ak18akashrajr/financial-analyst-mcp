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
  /** True when this turn ended via ASK_CLARIFYING_QUESTION_TOOL instead of a
   * real answer — see clarifying-question-tool.ts's doc comment. Mirrors the
   * same field already in the "Chat request completed" stdout log line, but
   * persisted here so it survives past stdout's retention window. */
  clarifyingQuestionAsked: boolean;
  /** Undefined when no provider response this request reported a usage
   * field at all (see providers/extract-usage.ts) — stored as null, not 0,
   * so "unknown" stays distinguishable from "really used zero tokens". */
  promptTokens?: number;
  completionTokens?: number;
  /** Undefined for a model with no entry in _shared/pricing.ts's table
   * (including one whose real cost is unknown, not necessarily free) — see
   * that module's isKnownFreeModel()/estimateCostUsd(). Stored as null. */
  estimatedCostUsd?: number;
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
      prompt_tokens: record.promptTokens ?? null,
      completion_tokens: record.completionTokens ?? null,
      estimated_cost_usd: record.estimatedCostUsd ?? null,
      suspicious_input: record.suspiciousInput,
      output_guardrail_triggered: record.outputGuardrailTriggered,
      clarifying_question_asked: record.clarifyingQuestionAsked,
      error: record.error ?? null,
    });
    if (error) logger.warn("Failed to write llm_requests row", { requestId: record.requestId, error: error.message });
  } catch (err) {
    logger.warn("Failed to write llm_requests row", { requestId: record.requestId, error: err });
  }
}
