import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, unauthorizedResponse } from "../_shared/auth.ts";
import { createDbLogSink } from "../_shared/db-log-sink.ts";

const corsHeaders = buildCorsHeaders();

const logger = createLogger("fetch-historical-prices");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Writes to historical_prices via the service-role key below (bypasses
  // RLS by design) — must independently verify a real logged-in user, same
  // as portfolio-ai (see docs/security-review.md finding #1 and its follow-up).
  const { user, reason } = await requireUser(req);
  if (!user) {
    logger.warn("Rejected unauthenticated fetch-historical-prices request", { reason });
    return unauthorizedResponse(corsHeaders);
  }
  logger.attachSink(createDbLogSink(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)));

  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = Array.isArray(body.symbols) ? body.symbols : [];
    const range: string = body.range || "10y";
    const interval: string = body.interval || "1mo";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const result: Record<string, { date: string; close: number }[]> = {};
    const writeErrors: Record<string, string> = {};

    for (const sym of symbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) { result[sym] = []; continue; }
        const data = await r.json();
        const res = data?.chart?.result?.[0];
        const ts: number[] = res?.timestamp || [];
        const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
        const points: { date: string; close: number }[] = [];
        for (let i = 0; i < ts.length; i++) {
          const c = closes[i];
          if (c == null) continue;
          points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
        }
        result[sym] = points;
        if (points.length > 0) {
          const rows = points.map((p) => ({ symbol: sym, date: p.date, close: p.close }));
          for (let i = 0; i < rows.length; i += 500) {
            // Supabase's upsert doesn't throw on a DB error, it resolves with
            // one — the surrounding try/catch never saw it, so a failed
            // write here used to look identical to a successful one, both to
            // the caller (result[sym] still held the fetched points) and to
            // anyone reading the logs (nothing was ever written about it).
            const { error: upsertError } = await supabase
              .from("historical_prices")
              .upsert(rows.slice(i, i + 500), { onConflict: "symbol,date" });
            if (upsertError) {
              logger.error("Failed to upsert historical_prices", { symbol: sym, error: upsertError, rowCount: rows.length });
              writeErrors[sym] = upsertError.message;
            }
          }
        }
      } catch (err) {
        logger.error("Failed to fetch historical prices", { symbol: sym, error: err });
        result[sym] = [];
      }
    }

    const failed = Object.entries(result).filter(([, points]) => points.length === 0).map(([sym]) => sym);
    logger.info("Historical price fetch batch complete", {
      requested: symbols.length,
      succeeded: symbols.length - failed.length,
      failed,
      writeErrors,
    });

    return new Response(JSON.stringify({ prices: result, writeErrors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error("Unhandled error", { error: err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
