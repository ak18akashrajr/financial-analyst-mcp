// Shared CORS headers for every edge function.
//
// The allowed origin is read from the ALLOWED_ORIGIN secret so it's the
// actual deployed frontend origin, not a wildcard. Falls back to "*" only
// when the secret isn't set (e.g. a fresh project before the frontend is
// deployed, or running locally with `supabase functions serve`) so setup
// isn't blocked on configuring this on day one — see README.md's deployment
// steps for how to set it once the Vercel URL is known.
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";

export function buildCorsHeaders(extraAllowedHeaders = ""): Record<string, string> {
  const baseHeaders = "authorization, x-client-info, apikey, content-type";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": extraAllowedHeaders ? `${baseHeaders}, ${extraAllowedHeaders}` : baseHeaders,
  };
}
