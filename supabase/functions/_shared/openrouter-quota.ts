// Daily quota tracking for the opt-in OpenRouter models (Nemotron 3 Ultra /
// MiniMax M2.7) — see docs/openrouter-nemotron-plan.md. Each free model has
// its own independent daily allowance on OpenRouter, so quota is tracked per
// model id, not per provider.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export const NEMOTRON_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const MINIMAX_MODEL_ID = "minimax/minimax-m2.7:free";

export const OPENROUTER_MODEL_ATTRIBUTION: Record<string, string> = {
  [NEMOTRON_MODEL_ID]: "NVIDIA Nemotron 3 Ultra via OpenRouter",
  [MINIMAX_MODEL_ID]: "MiniMax M2.7 via OpenRouter",
};

// Nemotron's free-tier daily cap (200 RPD) is confirmed directly from
// OpenRouter's own model page as of 2026-08-30 — see the plan doc's rollout
// task 1. MiniMax's is NOT yet confirmed (same doc, task 1a); 200 here is a
// conservative placeholder, not a verified number. Both read from an env var
// override first, so confirming (or OpenRouter changing) the real number is
// a one-line secret update — no code/deploy needed.
const DEFAULT_DAILY_CAPS: Record<string, number> = {
  [NEMOTRON_MODEL_ID]: 200,
  [MINIMAX_MODEL_ID]: 200,
};

const ENV_OVERRIDE_KEYS: Record<string, string> = {
  [NEMOTRON_MODEL_ID]: "OPENROUTER_NEMOTRON_DAILY_CAP",
  [MINIMAX_MODEL_ID]: "OPENROUTER_MINIMAX_DAILY_CAP",
};

/** The daily request cap in effect for `modelId` — the env override if one's
 * set and parses to a positive number, else the conservative default above.
 * Returns 0 for an unrecognized model id, which checkAndIncrementQuota below
 * treats as "no quota available". */
export function dailyCapFor(modelId: string): number {
  const envKey = ENV_OVERRIDE_KEYS[modelId];
  const override = envKey ? Deno.env.get(envKey) : undefined;
  if (override) {
    const parsed = Number(override);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DAILY_CAPS[modelId] ?? 0;
}

/** Same read-then-write shape (and the same benign-race trade-off) as
 * _shared/rate-limit.ts's checkRateLimit — see that file's doc comment for
 * why an atomic increment isn't needed here either. Counts every attempt at
 * `modelId` today, not just ones that ultimately succeed: same convention as
 * ai_rate_limits, and simpler than tracking success/failure separately for
 * what's fundamentally a cost/quota guard, not a strict SLA. A request that
 * gets counted here but then falls back to Groq (e.g. OpenRouter itself
 * returned a 429) is an accepted, minor over-count for the same reason.
 *
 * Returns true (and records the attempt) if `modelId` still has headroom in
 * today's quota, false if today's cap is already reached. */
export async function checkAndIncrementQuota(sb: SupabaseClient, modelId: string): Promise<boolean> {
  const cap = dailyCapFor(modelId);
  if (cap <= 0) return false;
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await sb
    .from("llm_quota_usage")
    .select("request_count")
    .eq("date", today)
    .eq("model_id", modelId)
    .maybeSingle();

  if (!existing) {
    await sb.from("llm_quota_usage").insert({ date: today, model_id: modelId, request_count: 1 });
    return true;
  }

  if (existing.request_count >= cap) return false;

  await sb
    .from("llm_quota_usage")
    .update({ request_count: existing.request_count + 1 })
    .eq("date", today)
    .eq("model_id", modelId);
  return true;
}
