// Unit tests for recordLlmRequest() — the request-level counterpart to
// audit-log.ts's per-tool-call audit trail (migration
// 20260909120000_add_llm_requests_and_request_id.sql). Same style as
// audit-log.test.ts: a minimal fake Supabase client and fake logger, testing
// the insert shape and the never-throws-on-failure contract.
import { describe, expect, it, vi } from "vitest";
import { recordLlmRequest } from "./llm-request-log.ts";
import type { Logger } from "./logger.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), timed: vi.fn() } as unknown as Logger;
}

function fakeSupabase(insertResult: { error: { message: string } | null } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { from, insert };
}

describe("recordLlmRequest", () => {
  it("inserts a row keyed by requestId with the full request summary", async () => {
    const sb = fakeSupabase();
    const logger = fakeLogger();
    await recordLlmRequest(sb as any, logger, {
      requestId: "req-abc",
      actor: "user-1",
      provider: "groq",
      model: "openai/gpt-oss-20b",
      modelPreference: "auto",
      status: "success",
      escalated: false,
      openRouterFallback: false,
      forcedGroundingRetryUsed: false,
      toolCallCount: 2,
      durationMs: 850,
      suspiciousInput: false,
      outputGuardrailTriggered: false,
    });
    expect(sb.from).toHaveBeenCalledWith("llm_requests");
    expect(sb.insert).toHaveBeenCalledWith({
      id: "req-abc",
      actor: "user-1",
      provider: "groq",
      model: "openai/gpt-oss-20b",
      model_preference: "auto",
      status: "success",
      escalated: false,
      open_router_fallback: false,
      forced_grounding_retry_used: false,
      tool_call_count: 2,
      duration_ms: 850,
      suspicious_input: false,
      output_guardrail_triggered: false,
      error: null,
    });
  });

  it("carries the error message through on a failed request", async () => {
    const sb = fakeSupabase();
    const logger = fakeLogger();
    await recordLlmRequest(sb as any, logger, {
      requestId: "req-xyz",
      actor: "user-1",
      provider: "openrouter",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      modelPreference: "nemotron",
      status: "error",
      escalated: false,
      openRouterFallback: false,
      forcedGroundingRetryUsed: false,
      toolCallCount: 0,
      durationMs: 25_000,
      suspiciousInput: false,
      outputGuardrailTriggered: false,
      error: "Request timed out",
    });
    expect(sb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "Request timed out" }),
    );
  });

  it("warn-logs but does not throw when the insert returns an error", async () => {
    const sb = fakeSupabase({ error: { message: "relation does not exist" } });
    const logger = fakeLogger();
    await expect(
      recordLlmRequest(sb as any, logger, {
        requestId: "req-abc",
        actor: "user-1",
        provider: "groq",
        model: "openai/gpt-oss-20b",
        modelPreference: "auto",
        status: "success",
        escalated: false,
        openRouterFallback: false,
        forcedGroundingRetryUsed: false,
        toolCallCount: 0,
        durationMs: 10,
        suspiciousInput: false,
        outputGuardrailTriggered: false,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to write llm_requests row",
      expect.objectContaining({ requestId: "req-abc" }),
    );
  });

  it("warn-logs but does not throw when the insert call itself rejects (e.g. sb.from is not a function on a bare fake client)", async () => {
    const sb = {};
    const logger = fakeLogger();
    await expect(
      recordLlmRequest(sb as any, logger, {
        requestId: "req-abc",
        actor: "user-1",
        provider: "groq",
        model: "openai/gpt-oss-20b",
        modelPreference: "auto",
        status: "success",
        escalated: false,
        openRouterFallback: false,
        forcedGroundingRetryUsed: false,
        toolCallCount: 0,
        durationMs: 10,
        suspiciousInput: false,
        outputGuardrailTriggered: false,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
