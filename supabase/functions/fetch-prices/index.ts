import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, unauthorizedResponse } from "../_shared/auth.ts";
import { selectPricesToWrite } from "../_shared/price-diff.ts";
import { createDbLogSink } from "../_shared/db-log-sink.ts";

const corsHeaders = buildCorsHeaders();

const logger = createLogger("fetch-prices");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Writes to current_prices via the service-role key below (bypasses RLS
  // by design) — must independently verify a real logged-in user, same as
  // portfolio-ai (see docs/security-review.md finding #1 and its follow-up).
  const { user, reason } = await requireUser(req);
  if (!user) {
    logger.warn("Rejected unauthenticated fetch-prices request", { reason });
    return unauthorizedResponse(corsHeaders);
  }
  logger.attachSink(createDbLogSink(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)));

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
    let writeError: string | null = null;
    if (symbolsToCheck.length > 0) {
      const { data: existingRows, error: selectError } = await supabase
        .from("current_prices")
        .select("symbol, price")
        .in("symbol", symbolsToCheck);
      // A real DB error here (not just "no matching rows") silently made
      // every fetched symbol look brand-new (previous === undefined), so it
      // still got written — just without the log line to say the diff check
      // itself couldn't run as intended.
      if (selectError) logger.error("Failed to read existing prices for diffing", { error: selectError });
      const existing: Record<string, number> = {};
      for (const row of existingRows || []) existing[row.symbol] = Number(row.price);

      const diff = selectPricesToWrite(fetchedNonNull, existing);
      changed = diff.changed;
      unchanged = diff.unchanged;

      const rows = Object.entries(diff.toWrite).map(([symbol, price]) => ({ symbol, price }));
      if (rows.length > 0) {
        const { error: upsertError } = await supabase.from("current_prices").upsert(rows, { onConflict: "symbol" });
        // Without this, a failed write here was reported to the caller as a
        // success (the response always claimed `changed`/`unchanged` from the
        // in-memory diff, regardless of whether the upsert actually landed)
        // with no trace anywhere that current_prices didn't get updated.
        if (upsertError) {
          logger.error("Failed to upsert current_prices", { error: upsertError, symbolCount: rows.length });
          writeError = upsertError.message;
        }
      }
    }

    logger.info("Price fetch batch complete", {
      requested: symbols.length,
      succeeded: symbols.length - failed.length,
      failed,
      changed: changed.length,
      unchanged: unchanged.length,
      writeError,
    });

    // writeError surfaces a failed upsert to the caller too, not just the
    // server-side log line above — otherwise a failed write was previously
    // indistinguishable from a real success on the response the frontend
    // actually sees.
    return new Response(JSON.stringify({ prices, changed, unchanged, writeError }), {
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
