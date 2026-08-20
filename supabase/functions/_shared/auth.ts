// Verifies that an incoming edge-function request carries a real, logged-in
// user's session token — not just any validly-signed project JWT.
//
// Supabase's platform-level `verify_jwt` only checks that the bearer token is
// *a* signed JWT for the project; the public anon/publishable key satisfies
// that check too, since it's a JWT by design (that's what makes it safe to
// ship in the client bundle). It says nothing about whether a specific user
// is logged in. portfolio-ai and portfolio-mcp-server both go on to read/
// derive from the full portfolio using the service-role key (which bypasses
// RLS entirely), so they must not rely on the platform check alone — this
// helper is the actual per-user authorization gate for those functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export interface AuthenticatedUser {
  id: string;
}

/**
 * Extracts the bearer token from `req` and validates it against Supabase
 * Auth. Returns the authenticated user, or `null` if the request has no
 * token or the token doesn't belong to a real logged-in session (expired,
 * malformed, or — importantly — the anon/service-role key itself, which is
 * not a user session and `auth.getUser` correctly rejects).
 */
export async function requireUser(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // SUPABASE_ANON_KEY is one of the secrets Supabase injects into every edge
  // function by default (alongside SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) —
  // no separate secret needs to be configured for this.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/** Standard 401 body/shape for an unauthenticated request, given a function's own corsHeaders. */
export function unauthorizedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized — please sign in again." }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
