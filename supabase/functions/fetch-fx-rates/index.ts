import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = buildCorsHeaders();

const logger = createLogger("fetch-fx-rates");

const PAIR = "USDINR";

type Point = { date: string; rate: number };
type Attempt = { source: string; ok: boolean; note: string };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Source 1: Yahoo Finance USDINR=X — live + long daily history, no API key. */
async function yahoo(range: string, interval: string): Promise<Point[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/USDINR%3DX?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const data = await r.json();
  const res = data?.chart?.result?.[0];
  const ts: number[] = res?.timestamp || [];
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
  const points: Point[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c) || c <= 0) continue;
    points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), rate: c });
  }
  // Include the live quote for today when available
  const live = res?.meta?.regularMarketPrice;
  if (live != null && isFinite(live) && live > 0) {
    const t = todayISO();
    const existing = points.find((p) => p.date === t);
    if (existing) existing.rate = live;
    else points.push({ date: t, rate: live });
  }
  if (points.length === 0) throw new Error("yahoo empty");
  return points;
}

/** Source 2: Frankfurter (ECB reference rates), no API key. */
async function frankfurter(fromDate?: string): Promise<Point[]> {
  const url = fromDate
    ? `https://api.frankfurter.app/${fromDate}..?from=USD&to=INR`
    : `https://api.frankfurter.app/latest?from=USD&to=INR`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`frankfurter ${r.status}`);
  const data = await r.json();
  if (data?.rates && data?.date && typeof data.rates.INR === "number") {
    return [{ date: data.date, rate: data.rates.INR }];
  }
  const points: Point[] = [];
  for (const [date, obj] of Object.entries<Record<string, number>>(data?.rates ?? {})) {
    const v = obj?.INR;
    if (typeof v === "number" && v > 0) points.push({ date, rate: v });
  }
  if (points.length === 0) throw new Error("frankfurter empty");
  return points;
}

/** Source 3: open.er-api.com free tier — latest only, no API key. */
async function openErApi(): Promise<Point[]> {
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!r.ok) throw new Error(`open.er-api ${r.status}`);
  const data = await r.json();
  const v = data?.rates?.INR;
  if (typeof v !== "number" || v <= 0) throw new Error("open.er-api empty");
  const date = data?.time_last_update_utc
    ? new Date(data.time_last_update_utc).toISOString().slice(0, 10)
    : todayISO();
  return [{ date, rate: v }];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Writes to fx_rates via the service-role key below (bypasses RLS by
  // design) — must independently verify a real logged-in user, same as
  // portfolio-ai (see docs/security-review.md finding #1 and its follow-up).
  const user = await requireUser(req);
  if (!user) {
    logger.warn("Rejected unauthenticated fetch-fx-rates request");
    return unauthorizedResponse(corsHeaders);
  }

  const attempts: Attempt[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode === "history" ? "history" : "latest";
    const range: string = ["1y", "3y", "5y", "10y", "max"].includes(body.range) ? body.range : "5y";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let points: Point[] = [];
    let source = "";

    const chain: Array<{ name: string; run: () => Promise<Point[]> }> =
      mode === "history"
        ? [
            { name: "Yahoo Finance (USDINR=X)", run: () => yahoo(range, "1d") },
            {
              name: "Frankfurter (ECB)",
              run: () => {
                const years = range === "max" ? 20 : parseInt(range) || 5;
                const d = new Date();
                d.setFullYear(d.getFullYear() - years);
                return frankfurter(d.toISOString().slice(0, 10));
              },
            },
          ]
        : [
            { name: "Yahoo Finance (USDINR=X)", run: () => yahoo("5d", "1d") },
            { name: "Frankfurter (ECB)", run: () => frankfurter() },
            { name: "open.er-api.com", run: () => openErApi() },
          ];

    for (const s of chain) {
      try {
        const p = await s.run();
        points = p;
        source = s.name;
        attempts.push({ source: s.name, ok: true, note: `${p.length} point(s)` });
        break;
      } catch (e) {
        attempts.push({ source: s.name, ok: false, note: String((e as Error).message || e) });
      }
    }

    if (points.length === 0) {
      // Final fallback: last stored rate, explicitly flagged as cached
      const { data: cached } = await supabase
        .from("fx_rates")
        .select("date, rate, source")
        .eq("pair", PAIR)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      attempts.push({
        source: "Database cache",
        ok: !!cached,
        note: cached ? `last stored ${cached.date}` : "no cached rate",
      });

      logger.warn("All live FX sources failed, serving cached rate", { attempts, cached: !!cached });

      return new Response(
        JSON.stringify({
          rate: cached?.rate ?? null,
          date: cached?.date ?? null,
          source: cached ? `cached · ${cached.source}` : null,
          stale: true,
          inserted: 0,
          attempts,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: cached ? 200 : 502 }
      );
    }

    const rows = points.map((p) => ({
      pair: PAIR,
      date: p.date,
      rate: p.rate,
      source,
      fetched_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("fx_rates")
        .upsert(rows.slice(i, i + 500), { onConflict: "pair,date" });
      if (error) logger.error("Upsert error", { error });
    }

    const latest = points.reduce((a, b) => (a.date >= b.date ? a : b));
    logger.info("FX rate fetch complete", { source, inserted: rows.length, attempts });

    return new Response(
      JSON.stringify({
        rate: latest.rate,
        date: latest.date,
        source,
        stale: false,
        inserted: rows.length,
        attempts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    logger.error("Unhandled error", { error: err, attempts });
    return new Response(JSON.stringify({ error: "Internal server error", attempts }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
