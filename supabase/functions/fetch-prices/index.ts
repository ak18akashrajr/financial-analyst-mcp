import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, unauthorizedResponse } from "../_shared/auth.ts";
import { selectPricesToWrite } from "../_shared/price-diff.ts";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Only write rows whose price actually moved — this table is re-fetched
    // on every homepage load (see useAutoRefreshPricesOnLoad), and an
    // unconditional upsert of every symbol on every visit means N no-op
    // writes/day forever for a table whose row count never grows. See
    // docs/scaling-and-archival-plan.md's addendum.
    const fetchedNonNull: Record<string, number> = {};
    for (const [symbol, price] of Object.entries(prices)) {
      if (price != null) fetchedNonNull[symbol] = price;
    }

    const symbolsToCheck = Object.keys(fetchedNonNull);
    let changed: string[] = [];
    let unchanged: string[] = [];
    if (symbolsToCheck.length > 0) {
      const { data: existingRows } = await supabase
        .from("current_prices")
        .select("symbol, price")
        .in("symbol", symbolsToCheck);
      const existing: Record<string, number> = {};
      for (const row of existingRows || []) existing[row.symbol] = Number(row.price);

      const diff = selectPricesToWrite(fetchedNonNull, existing);
      changed = diff.changed;
      unchanged = diff.unchanged;

      const rows = Object.entries(diff.toWrite).map(([symbol, price]) => ({ symbol, price }));
      if (rows.length > 0) {
        await supabase.from("current_prices").upsert(rows, { onConflict: "symbol" });
      }
    }

    logger.info("Price fetch batch complete", {
      requested: symbols.length,
      succeeded: symbols.length - failed.length,
      failed,
      changed: changed.length,
      unchanged: unchanged.length,
    });

    return new Response(JSON.stringify({ prices, changed, unchanged }), {
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
