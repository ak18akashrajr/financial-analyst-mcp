const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replicate yfinance's crumb-based auth flow
async function getCrumbAndCookies(): Promise<{ crumb: string; cookie: string }> {
  // Step 1: Visit Yahoo Finance to get cookies
  const initRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    redirect: "manual",
  });
  
  const setCookies = initRes.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");

  // Step 2: Get crumb using cookies
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": cookieStr,
    },
  });

  const crumb = await crumbRes.text();
  
  // Combine cookies from both responses
  const crumbCookies = crumbRes.headers.getSetCookie?.() ?? [];
  const allCookies = [...setCookies, ...crumbCookies].map(c => c.split(";")[0]).join("; ");

  return { crumb, cookie: allCookies };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { symbol } = await req.json();

    if (!symbol || typeof symbol !== "string") {
      return new Response(
        JSON.stringify({ error: "symbol is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get crumb + cookies (like yfinance does)
    const { crumb, cookie } = await getCrumbAndCookies();
    console.log("Got crumb:", crumb ? "yes" : "no");

    // Fetch quoteSummary with crumb (same as yfinance ticker.info)
    const modules = "summaryDetail,price,defaultKeyStatistics";
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": cookie,
      },
    });

    if (!res.ok) {
      console.error(`quoteSummary returned ${res.status} for ${symbol}`);
      // Fallback to chart endpoint for price only
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const chartRes = await fetch(chartUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      const chartData = chartRes.ok ? await chartRes.json() : null;
      const meta = chartData?.chart?.result?.[0]?.meta;

      return new Response(
        JSON.stringify({
          symbol,
          name: meta?.shortName ?? symbol,
          price: meta?.regularMarketPrice ?? null,
          trailing_pe: null,
          forward_pe: null,
          market_cap: null,
          fifty_two_week_high: meta?.fiftyTwoWeekHigh ?? null,
          fifty_two_week_low: meta?.fiftyTwoWeekLow ?? null,
          dividend_yield: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    const sd = result?.summaryDetail ?? {};
    const pr = result?.price ?? {};
    const ks = result?.defaultKeyStatistics ?? {};

    return new Response(
      JSON.stringify({
        symbol,
        name: pr?.shortName ?? symbol,
        price: pr?.regularMarketPrice?.raw ?? null,
        trailing_pe: sd?.trailingPE?.raw ?? null,
        forward_pe: sd?.forwardPE?.raw ?? ks?.forwardPE?.raw ?? null,
        market_cap: pr?.marketCap?.raw ?? null,
        fifty_two_week_high: sd?.fiftyTwoWeekHigh?.raw ?? null,
        fifty_two_week_low: sd?.fiftyTwoWeekLow?.raw ?? null,
        dividend_yield: sd?.dividendYield?.raw ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in fetch-pe-ratio:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
