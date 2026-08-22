// Unit tests for recordToolCall() — the persistent audit trail for
// portfolio-mcp-server tool calls (security-review.md addendum, second audit
// 2026-08-22). Uses a minimal fake Supabase client and a fake logger rather
// than real ones; what's under test is the insert shape and the
// never-throws-on-failure contract, not Supabase or logging itself.
import { describe, expect, it, vi } from "vitest";
import { recordToolCall } from "./audit-log.ts";
import type { Logger } from "./logger.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), timed: vi.fn() } as unknown as Logger;
}

function fakeSupabase(insertResult: { error: { message: string } | null } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { from, insert };
}

describe("recordToolCall", () => {
  it("inserts a row with the tool name, args, duration, and success", async () => {
    const sb = fakeSupabase();
    const logger = fakeLogger();
    await recordToolCall(sb as any, logger, {
      tool: "get_portfolio_summary",
      actor: "user-1",
      args: { topN: 5 },
      durationMs: 42,
      success: true,
    });
    expect(sb.from).toHaveBeenCalledWith("audit_logs");
    expect(sb.insert).toHaveBeenCalledWith({
      actor: "user-1",
      tool_name: "get_portfolio_summary",
      arguments: { topN: 5 },
      duration_ms: 42,
      success: true,
      error: null,
    });
  });

  it("defaults actor and error to null when not supplied", async () => {
    const sb = fakeSupabase();
    const logger = fakeLogger();
    await recordToolCall(sb as any, logger, {
      tool: "list_holdings",
      args: {},
      durationMs: 10,
      success: false,
      error: "boom",
    });
    expect(sb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null, error: "boom", success: false }),
    );
  });

  it("warn-logs but does not throw when the insert returns an error", async () => {
    const sb = fakeSupabase({ error: { message: "relation does not exist" } });
    const logger = fakeLogger();
    await expect(
      recordToolCall(sb as any, logger, { tool: "get_risk_metrics", args: {}, durationMs: 1, success: true }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to write audit log row",
      expect.objectContaining({ tool: "get_risk_metrics" }),
    );
  });

  it("warn-logs but does not throw when the insert call itself rejects", async () => {
    const sb = { from: vi.fn().mockReturnValue({ insert: vi.fn().mockRejectedValue(new Error("network down")) }) };
    const logger = fakeLogger();
    await expect(
      recordToolCall(sb as any, logger, { tool: "run_stress_test", args: {}, durationMs: 1, success: true }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
