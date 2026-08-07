import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildPortfolioContext(holdings: any[], totalInvested: number, totalCurrentValue: number, totalPnl: number, liquidCash: number, vaultCash: number, totalPortfolioValue: number, geoExposure: Record<string, number>, catExposure: Record<string, number>, concentrationRisk: any[], top5Weight: number, topGainers: any[], topLosers: any[], recentTxns: any[]) {
  const formatExposure = (map: Record<string, number>) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        value: Math.round(value),
        percent: totalCurrentValue > 0 ? ((value / totalCurrentValue) * 100).toFixed(1) : "0",
      }));

  return `
## LIVE PORTFOLIO DATA (as of ${new Date().toISOString()})

### Summary
- Total Invested: ₹${totalInvested.toLocaleString("en-IN")}
- Current Market Value: ₹${totalCurrentValue.toLocaleString("en-IN")}
- Total P&L: ₹${totalPnl.toLocaleString("en-IN")} (${totalInvested !== 0 ? ((totalPnl / totalInvested) * 100).toFixed(2) : 0}%)
- Liquid Cash: ₹${liquidCash.toLocaleString("en-IN")}
- Vault Cash: ₹${vaultCash.toLocaleString("en-IN")}
- Total Portfolio Value (incl. cash): ₹${totalPortfolioValue.toLocaleString("en-IN")}

### Holdings (${holdings.length} active positions)
${holdings.map(h => `- ${h.symbol}: ${h.quantity} units @ avg ₹${h.avgPrice.toFixed(2)}, CMP ₹${h.currentPrice}, Value ₹${Math.round(h.currentValue).toLocaleString("en-IN")}, P&L ₹${Math.round(h.pnl).toLocaleString("en-IN")} (${h.pnlPercent.toFixed(1)}%) [${h.geography}/${h.category}]`).join("\n")}

### Exposure by Geography
${formatExposure(geoExposure).map(e => `- ${e.label}: ₹${e.value.toLocaleString("en-IN")} (${e.percent}%)`).join("\n")}

### Exposure by Category
${formatExposure(catExposure).map(e => `- ${e.label}: ₹${e.value.toLocaleString("en-IN")} (${e.percent}%)`).join("\n")}

### Concentration Risk (Top 5)
${concentrationRisk.map(c => `- ${c.symbol}: ${c.weight}% (₹${c.value.toLocaleString("en-IN")})`).join("\n")}
- Top 5 combined: ${top5Weight.toFixed(1)}%

### Top Gainers
${topGainers.map(h => `- ${h.symbol}: +${h.pnlPercent.toFixed(1)}% (₹${Math.round(h.pnl).toLocaleString("en-IN")})`).join("\n")}

### Top Losers
${topLosers.length > 0 ? topLosers.map(h => `- ${h.symbol}: ${h.pnlPercent.toFixed(1)}% (₹${Math.round(h.pnl).toLocaleString("en-IN")})`).join("\n") : "None"}

### Recent Transactions
${recentTxns.map(t => `- ${t.date}: ${t.type} ${t.quantity} × ${t.symbol} @ ₹${t.price}`).join("\n")}
`;
}

const SYSTEM_PROMPT_TEMPLATE = (portfolioContext: string) => `You are Portfolio Intelligence AI — an expert portfolio analyst connected to the user's live portfolio data via MCP (Model Context Protocol).

You have REAL-TIME access to the user's actual portfolio. All data below is live — not sample data.

${portfolioContext}

## Your Capabilities (Tools Available)
1. **get_portfolio_summary** — High-level snapshot of the portfolio
2. **list_holdings** — All current positions with details
3. **get_exposure_by_sector / geography / category** — Breakdown analysis
4. **get_concentration_risk** — Top holdings by weight, flags dangerous concentration
5. **get_risk_metrics** — Beta, volatility estimates based on holdings
6. **run_stress_test** — Simulate market crashes (-20%, -35%, -50%) on actual holdings
7. **check_limit_breaches** — Flag overweight sectors or concentrated positions
8. **compare_to_benchmark** — Compare against NIFTY 50 performance
9. **get_exposure_drift** — Track how weights changed over time
10. **ask_portfolio_intelligence** — Natural language Q&A grounded in real data

## Response Guidelines
- Always use the REAL data provided above. Never hallucinate numbers.
- Format currency in Indian style (₹, Lakhs, Crores where appropriate).
- When discussing risk, be specific — name the stocks and percentages.
- Use clear formatting with headers, bullet points, and bold text for key figures.
- If asked to run a stress test, simulate it using the actual holdings and their weights.
- For concentration risk, flag any single holding above 15% or top-5 above 50%.
- Be conversational but data-driven. You are the user's personal risk analyst.
- When showing tool calls, mention which "tool" you're using (e.g., "Let me run get_concentration_risk...").
- Keep responses focused and actionable. End with a recommendation when appropriate.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

    if (!LOVABLE_API_KEY && !GROQ_API_KEY) {
      throw new Error("No AI API keys configured");
    }

    // Fetch portfolio data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const [txnRes, cashRes, priceRes, metaRes] = await Promise.all([
      sb.from("transactions").select("*").order("date", { ascending: false }),
      sb.from("cash_settings").select("*").limit(1).single(),
      sb.from("current_prices").select("*"),
      sb.from("symbol_metadata").select("*"),
    ]);

    const txns = txnRes.data || [];
    const prices: Record<string, number> = {};
    for (const p of priceRes.data || []) prices[p.symbol] = Number(p.price);
    const meta: Record<string, { geography: string; sector: string }> = {};
    for (const m of metaRes.data || []) meta[m.symbol] = { geography: m.geography, sector: m.sector };

    const bySymbol: Record<string, { qty: number; invested: number }> = {};
    for (const t of txns) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { qty: 0, invested: 0 };
      const entry = bySymbol[t.symbol];
      if (t.type === "BUY") {
        entry.qty += Number(t.quantity);
        entry.invested += Number(t.quantity) * Number(t.price);
      } else {
        entry.qty -= Number(t.quantity);
        entry.invested -= Number(t.quantity) * Number(t.price);
      }
    }

    const holdings = Object.entries(bySymbol)
      .filter(([_, h]) => h.qty > 0)
      .map(([symbol, h]) => {
        const cp = prices[symbol] || 0;
        const currentValue = cp * h.qty;
        const pnl = currentValue - h.invested;
        const pnlPct = h.invested !== 0 ? (pnl / h.invested) * 100 : 0;
        const m = meta[symbol];
        return { symbol, quantity: h.qty, avgPrice: h.invested / h.qty, currentPrice: cp, invested: h.invested, currentValue, pnl, pnlPercent: pnlPct, geography: m?.geography || "Untagged", category: m?.sector || "Untagged" };
      });

    const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
    const totalCurrentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
    const totalPnl = totalCurrentValue - totalInvested;
    const liquidCash = Number(cashRes.data?.liquid_cash || 0);
    const vaultCash = Number(cashRes.data?.vault_cash || 0);
    const totalPortfolioValue = totalCurrentValue + liquidCash + vaultCash;

    const geoExposure: Record<string, number> = {};
    const catExposure: Record<string, number> = {};
    for (const h of holdings) {
      geoExposure[h.geography] = (geoExposure[h.geography] || 0) + h.currentValue;
      catExposure[h.category] = (catExposure[h.category] || 0) + h.currentValue;
    }

    const sorted = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent);
    const topGainers = sorted.slice(0, 3);
    const topLosers = sorted.filter(h => h.pnlPercent < 0).slice(-3).reverse();

    const concentrationRisk = [...holdings]
      .sort((a, b) => b.currentValue - a.currentValue)
      .slice(0, 5)
      .map(h => ({
        symbol: h.symbol,
        weight: totalCurrentValue > 0 ? ((h.currentValue / totalCurrentValue) * 100).toFixed(1) : "0",
        value: Math.round(h.currentValue),
      }));
    const top5Weight = concentrationRisk.reduce((s, c) => s + parseFloat(c.weight), 0);

    const recentTxns = txns.slice(0, 10).map(t => ({
      symbol: t.symbol, type: t.type, quantity: t.quantity, price: t.price, date: t.date,
    }));

    const portfolioContext = buildPortfolioContext(holdings, totalInvested, totalCurrentValue, totalPnl, liquidCash, vaultCash, totalPortfolioValue, geoExposure, catExposure, concentrationRisk, top5Weight, topGainers, topLosers, recentTxns);
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(portfolioContext);

    // --- Primary: Lovable AI Gateway (Gemini 2.5 Flash) ---
    if (LOVABLE_API_KEY) {
      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            stream: true,
          }),
        });

        if (response.ok) {
          // Inject model tag into the stream
          const modelTag = "\n\n---\n*🤖 Response by **Gemini 2.5 Flash** (Primary)*\n";
          const taggedStream = injectModelTag(response.body!, modelTag);
          return new Response(taggedStream, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }

        // If 429/402, fall through to Groq
        if (response.status === 429 || response.status === 402) {
          console.log(`Primary model returned ${response.status}, falling back to Groq...`);
        } else {
          const t = await response.text();
          console.error("AI gateway error:", response.status, t);
          // Still try fallback
        }
      } catch (err) {
        console.error("Primary model call failed:", err);
      }
    }

    // --- Fallback: Groq (LLaMA 3.1 8B Instant) ---
    if (GROQ_API_KEY) {
      console.log("Using Groq fallback (llama-3.1-8b-instant)");
      const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
        }),
      });

      if (!groqResponse.ok) {
        const t = await groqResponse.text();
        console.error("Groq error:", groqResponse.status, t);
        return new Response(JSON.stringify({ error: "Both primary and fallback AI failed." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const modelTag = "\n\n---\n*🦙 Response by **LLaMA 3.1 8B** via Groq (Fallback)*\n";
      const taggedStream = injectModelTag(groqResponse.body!, modelTag);
      return new Response(taggedStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(JSON.stringify({ error: "All AI providers unavailable." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("portfolio-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Injects a model attribution tag as the final SSE data chunk before [DONE].
 */
function injectModelTag(body: ReadableStream<Uint8Array>, modelTag: string): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush remaining buffer
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(buffer));
        }
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Check if [DONE] is in the buffer
      const doneIdx = buffer.indexOf("data: [DONE]");
      if (doneIdx !== -1) {
        // Send everything before [DONE]
        const before = buffer.slice(0, doneIdx);
        if (before) controller.enqueue(encoder.encode(before));

        // Inject model tag as a proper SSE chunk
        const tagChunk = `data: ${JSON.stringify({
          choices: [{ delta: { content: modelTag }, index: 0 }],
        })}\n\n`;
        controller.enqueue(encoder.encode(tagChunk));

        // Send [DONE] and anything after
        const rest = buffer.slice(doneIdx);
        controller.enqueue(encoder.encode(rest));
        buffer = "";
      } else {
        // Forward data but keep last 50 chars in buffer to catch split [DONE]
        if (buffer.length > 50) {
          const toSend = buffer.slice(0, buffer.length - 50);
          buffer = buffer.slice(buffer.length - 50);
          controller.enqueue(encoder.encode(toSend));
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
