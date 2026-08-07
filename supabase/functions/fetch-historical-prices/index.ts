import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
            await supabase.from("historical_prices").upsert(rows.slice(i, i + 500), { onConflict: "symbol,date" });
          }
        }
      } catch (err) {
        console.error(`Error fetching ${sym}:`, err);
        result[sym] = [];
      }
    }

    return new Response(JSON.stringify({ prices: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
