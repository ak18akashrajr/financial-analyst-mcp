import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = buildCorsHeaders();

const logger = createLogger("fetch-prices");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Writes to current_prices via the service-role key below (bypasses RLS
  // by design) — must independently verify a real logged-in user, same as
  // portfolio-ai (see docs/security-review.md finding #1 and its follow-up).
  const user = await requireUser(req);
  if (!user) {
    logger.warn("Rejected unauthenticated fetch-prices request");
    return unauthorizedResponse(corsHeaders);
  }

  try {
    const { symbols } = await req.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "symbols array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch prices from Yahoo Finance
    const prices: Record<string, number | null> = {};

    for (const symbol of symbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });

        if (!response.ok) {
          logger.warn("Yahoo Finance returned non-OK status", { symbol, status: response.status });
          prices[symbol] = null;
          continue;
        }

        const data = await response.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const regularMarketPrice = meta?.regularMarketPrice;

        if (regularMarketPrice != null) {
          prices[symbol] = regularMarketPrice;
        } else {
          prices[symbol] = null;
        }
      } catch (err) {
        logger.error("Failed to fetch price", { symbol, error: err });
        prices[symbol] = null;
      }
    }

    const failed = Object.entries(prices).filter(([, p]) => p == null).map(([sym]) => sym);
    logger.info("Price fetch batch complete", {
      requested: symbols.length,
      succeeded: symbols.length - failed.length,
      failed,
    });

    // Update prices in the database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    for (const [symbol, price] of Object.entries(prices)) {
      if (price != null) {
        await supabase
          .from("current_prices")
          .upsert({ symbol, price }, { onConflict: "symbol" });
      }
    }

    return new Response(JSON.stringify({ prices }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error("Unhandled error", { error: err });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
