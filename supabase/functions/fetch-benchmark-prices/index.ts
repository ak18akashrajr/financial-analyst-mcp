// Populates public.benchmark_history from Yahoo Finance, mirroring the
// fetch-historical-prices function's approach for portfolio symbols. This is
// the "way to populate it" half of recreating benchmark_history (see
// supabase/migrations/20260808150000_recreate_benchmark_history.sql) — the
// MCP compare_to_benchmark / get_risk_metrics tools read from this table but
// have no way to fill it themselves.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Friendly names used by compare_to_benchmark / get_risk_metrics -> the
// actual Yahoo Finance ticker for that index. Update here if Yahoo renames a
// ticker; callers and stored rows keep using the friendly name either way.
const BENCHMARK_TICKERS: Record<string, string> = {
  NIFTY50: "^NSEI",
  NIFTY500: "^CRSLDX",
  SPX: "^GSPC",
};

const DEFAULT_BENCHMARKS = ["NIFTY50"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body.symbols) && body.symbols.length > 0
      ? body.symbols
      : DEFAULT_BENCHMARKS;
    const range: string = body.range || "2y";
    const interval: string = body.interval || "1d";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result: Record<string, { date: string; close: number }[] | { error: string }> = {};

    for (const sym of requested) {
      const ticker = BENCHMARK_TICKERS[sym];
      if (!ticker) {
        result[sym] = { error: `Unknown benchmark symbol "${sym}" — known symbols: ${Object.keys(BENCHMARK_TICKERS).join(", ")}` };
        continue;
      }
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) { result[sym] = { error: `Yahoo Finance returned ${r.status}` }; continue; }
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
          // Stored under the friendly symbol (NIFTY50), not the Yahoo ticker
          // (^NSEI), so compareToBenchmark/getRiskMetrics' `.eq("symbol", ...)`
          // lookups keep working unchanged.
          const rows = points.map((p) => ({ symbol: sym, date: p.date, close: p.close }));
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase
              .from("benchmark_history")
              .upsert(rows.slice(i, i + 500), { onConflict: "symbol,date" });
            if (error) { result[sym] = { error: error.message }; break; }
          }
        }
      } catch (err) {
        console.error(`Error fetching benchmark ${sym} (${ticker}):`, err);
        result[sym] = { error: String(err) };
      }
    }

    return new Response(JSON.stringify({ benchmarks: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
