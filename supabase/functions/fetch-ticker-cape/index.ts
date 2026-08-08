// Fetches ticker-level Shiller PE (CAPE) — price ÷ mean(inflation-adjusted 10Y EPS).
// Uses Yahoo Finance timeSeries endpoint for annual EPS. Fails gracefully for
// symbols without 10Y data (MFs, small caps) — those return { cape: null }.

import { createLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logger = createLogger("fetch-ticker-cape");

// Approx India CPI YoY (last 15 years, %). Used to inflation-adjust historical EPS.
// Source: MOSPI/RBI aggregates. Approximation flagged in UI.
const INDIA_CPI_YOY: number[] = [
  10.5, 9.5, 10.0, 9.4, 5.9, 4.9, 4.5, 3.6, 3.4, 4.8, 6.2, 5.5, 6.7, 5.4, 4.9,
];

function inflationAdjust(eps: number, yearsAgo: number): number {
  let factor = 1;
  for (let i = 0; i < yearsAgo && i < INDIA_CPI_YOY.length; i++) {
    factor *= 1 + INDIA_CPI_YOY[i] / 100;
  }
  return eps * factor;
}

async function getCrumbAndCookies(): Promise<{ crumb: string; cookie: string }> {
  const initRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
  });
  const setCookies = initRes.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookieStr },
  });
  const crumb = await crumbRes.text();
  const crumbCookies = crumbRes.headers.getSetCookie?.() ?? [];
  const allCookies = [...setCookies, ...crumbCookies].map(c => c.split(";")[0]).join("; ");
  return { crumb, cookie: allCookies };
}

async function fetchAnnualEPS(symbol: string, crumb: string, cookie: string): Promise<number[]> {
  // Yahoo timeSeries endpoint for annualDilutedEPS
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=annualDilutedEPS&period1=0&period2=${now}&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = data?.timeseries?.result?.[0]?.annualDilutedEPS ?? [];
  return rows
    .map((r: any) => r?.reportedValue?.raw)
    .filter((v: any) => typeof v === "number" && isFinite(v));
}

async function fetchPrice(symbol: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { symbol } = await req.json();
    if (!symbol || typeof symbol !== "string") {
      return new Response(JSON.stringify({ error: "symbol is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { crumb, cookie } = await getCrumbAndCookies();
    const [eps, price] = await Promise.all([
      fetchAnnualEPS(symbol, crumb, cookie),
      fetchPrice(symbol),
    ]);

    if (eps.length < 5 || price == null) {
      const reason = eps.length < 5 ? "insufficient EPS history (<5Y)" : "no price";
      logger.warn("Could not compute CAPE", { symbol, reason, epsYears: eps.length, price });
      return new Response(JSON.stringify({
        symbol, cape: null, eps_10y: eps, price, reason,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Take last 10 years max; adjust each to today's rupees
    const last10 = eps.slice(-10);
    const adjusted = last10.map((e, i) => inflationAdjust(e, last10.length - 1 - i));
    const meanRealEPS = adjusted.reduce((s, x) => s + x, 0) / adjusted.length;
    const cape = meanRealEPS > 0 ? price / meanRealEPS : null;

    return new Response(JSON.stringify({
      symbol, cape, eps_10y: last10, price, mean_real_eps: meanRealEPS,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    logger.error("Unhandled error", { error: err });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
