// Fixed-window rate limiting for portfolio-ai — a paid, LLM-backed endpoint.
// Bounds cost exposure from a scripted/looping caller even after finding #1
// (auth bypass) is fixed, since a real logged-in user's browser or a stolen
// session token could still hammer the endpoint otherwise.
//
// Implementation note: this does a read-then-write against
// public.ai_rate_limits rather than a single atomic SQL increment. That's a
// benign race for this single-user app (worst case: one or two extra
// requests squeak through in a given window under concurrent calls from the
// same user) — acceptable here since the goal is bounding runaway cost, not
// enforcing a hard security boundary. A Postgres function with `FOR UPDATE`
// would close that race if this app ever needed a stricter guarantee.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 10; // per user, per window

/** Returns true if `userId` is still within their request budget for the
 * current window (and records this request), false if they've hit the cap. */
export async function checkRateLimit(sb: SupabaseClient, userId: string): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS).toISOString();

  const { data: existing } = await sb
    .from("ai_rate_limits")
    .select("request_count")
    .eq("user_id", userId)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (!existing) {
    await sb.from("ai_rate_limits").insert({ user_id: userId, window_start: windowStart, request_count: 1 });
    return true;
  }

  if (existing.request_count >= RATE_LIMIT_MAX_REQUESTS) return false;

  await sb
    .from("ai_rate_limits")
    .update({ request_count: existing.request_count + 1 })
    .eq("user_id", userId)
    .eq("window_start", windowStart);
  return true;
}
