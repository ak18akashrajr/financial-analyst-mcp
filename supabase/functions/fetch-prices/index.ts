import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
          console.error(`Yahoo Finance returned ${response.status} for ${symbol}`);
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
        console.error(`Error fetching price for ${symbol}:`, err);
        prices[symbol] = null;
      }
    }

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
    console.error("Error in fetch-prices:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
