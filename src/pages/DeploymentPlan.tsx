import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PrivacyProvider } from '@/contexts/PrivacyContext';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Search, TrendingUp, TrendingDown, AlertTriangle, Zap, Shield, Flame } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { computeSignal } from '@/lib/deploymentSignal';
import { SignalDecomposition } from '@/components/deployment/SignalDecomposition';
import { MarketRegimeStrip } from '@/components/deployment/MarketRegimeStrip';
import { InfoHint } from '@/components/InfoHint';



interface PEData {
  symbol: string;
  name: string;
  price: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  market_cap: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  dividend_yield: number | null;
}

interface StrategyRow {
  range: string;
  signal: string;
  returns: string;
  action: string;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  min: number;
  max: number;
}

const strategies: StrategyRow[] = [
  { range: '> 25', signal: 'Bubble', returns: 'Negative', action: 'Build cash', icon: <Flame className="w-4 h-4" />, colorClass: 'text-red-500', bgClass: 'bg-red-500/10 border-red-500/30', min: 25.01, max: Infinity },
  { range: '20 – 25', signal: 'Expensive', returns: 'Below average', action: 'Regular SIP only', icon: <AlertTriangle className="w-4 h-4" />, colorClass: 'text-orange-500', bgClass: 'bg-orange-500/10 border-orange-500/30', min: 20, max: 25 },
  { range: '15 – 20', signal: 'Fair value', returns: 'Moderate', action: 'Increase SIP by 25–50%', icon: <TrendingUp className="w-4 h-4" />, colorClass: 'text-yellow-500', bgClass: 'bg-yellow-500/10 border-yellow-500/30', min: 15, max: 20 },
  { range: '12 – 15', signal: 'Undervalued', returns: 'Strong', action: 'Invest 2x–3x SIP', icon: <Shield className="w-4 h-4" />, colorClass: 'text-emerald-500', bgClass: 'bg-emerald-500/10 border-emerald-500/30', min: 12, max: 15 },
  { range: '< 12', signal: 'Extreme crisis', returns: 'Exceptional', action: 'Deploy maximum capital', icon: <Zap className="w-4 h-4" />, colorClass: 'text-green-500', bgClass: 'bg-green-500/10 border-green-500/30', min: -Infinity, max: 12 },
];

function getMatchingStrategy(pe: number): StrategyRow | null {
  return strategies.find(s => pe > s.min || (pe >= s.min && pe <= s.max)) ?? null;
}

function getActiveStrategyIndex(pe: number): number {
  if (pe > 25) return 0;
  if (pe >= 20) return 1;
  if (pe >= 15) return 2;
  if (pe >= 12) return 3;
  return 4;
}

function formatMarketCap(val: number | null): string {
  if (val == null) return 'N/A';
  if (val >= 1e12) return `₹${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `₹${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e7) return `₹${(val / 1e7).toFixed(2)}Cr`;
  if (val >= 1e5) return `₹${(val / 1e5).toFixed(2)}L`;
  return `₹${val.toFixed(0)}`;
}

const DeploymentPlanContent = () => {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [peData, setPeData] = useState<PEData | null>(null);
  const [manualPE, setManualPE] = useState('');
  const [marketCape, setMarketCape] = useState<number | null>(null);
  const [marketCapeMedian, setMarketCapeMedian] = useState<number>(24);
  const { holdings } = usePortfolio();

  const presetSymbols = Array.from(new Set(holdings.map(h => h.symbol))).sort();


  const fetchPE = async (overrideSymbol?: string) => {
    const sym = (overrideSymbol ?? ticker).trim().toUpperCase();
    if (!sym) { toast.error('Enter a ticker symbol'); return; }
    if (overrideSymbol) setTicker(sym);

    setLoading(true);
    setPeData(null);
    setManualPE('');
    try {
      const { data, error } = await supabase.functions.invoke('fetch-pe-ratio', {
        body: { symbol: sym },
      });

      if (error) {
        toast.error('Failed to fetch PE data');
        console.error(error);
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      setPeData(data as PEData);
      if (data.trailing_pe == null && data.forward_pe == null) {
        toast.warning('PE ratio not available via API. You can enter it manually below.');
      } else {
        toast.success(`Fetched PE data for ${data.name || sym}`);
      }
    } catch (err) {
      console.error(err);
      toast.error('Error fetching PE data');
    } finally {
      setLoading(false);
    }
  };

  const fetchedPE = peData?.trailing_pe ?? peData?.forward_pe ?? null;
  const pe = fetchedPE ?? (manualPE ? parseFloat(manualPE) : null);
  const activeIdx = pe != null && !isNaN(pe) ? getActiveStrategyIndex(pe) : -1;

  const signal = peData ? computeSignal({
    symbol: peData.symbol,
    price: peData.price,
    trailingPE: peData.trailing_pe ?? (manualPE ? parseFloat(manualPE) : null),
    forwardPE: peData.forward_pe,
    fiftyTwoWeekHigh: peData.fifty_two_week_high,
    fiftyTwoWeekLow: peData.fifty_two_week_low,
    dividendYield: peData.dividend_yield,
    marketCape,
    marketCapeMedian,
  }) : null;



  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/overview" className="text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Deployment Plan</h1>
              <p className="text-xs text-muted-foreground">PE-based capital deployment strategy</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { sessionStorage.removeItem('portfolio_auth'); window.location.reload(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              Logout
            </button>
            <ThemeToggle />
          </div>
        </div>

        {/* Market Regime Strip (NIFTY Shiller PE / CAPE) */}
        <MarketRegimeStrip onCapeChange={(v, m) => { setMarketCape(v); setMarketCapeMedian(m); }} />

        {/* Ticker Input */}
        <div className="bg-card border border-border rounded-lg p-4">

          <label className="text-sm font-medium text-foreground mb-2 block">Ticker Symbol</label>
          <p className="text-xs text-muted-foreground mb-3">
            For Indian stocks use <code className="bg-muted px-1 rounded">.NS</code> (NSE) or <code className="bg-muted px-1 rounded">.BO</code> (BSE) suffix. E.g. <code className="bg-muted px-1 rounded">RELIANCE.NS</code>, <code className="bg-muted px-1 rounded">TCS.NS</code>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && fetchPE()}
              placeholder="e.g. RELIANCE.NS"
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => fetchPE()}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              {loading ? 'Fetching...' : 'Analyze'}
            </button>
          </div>
          {presetSymbols.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Your Holdings — Quick Check</p>
              <div className="flex flex-wrap gap-1.5">
                {presetSymbols.map(sym => (
                  <button
                    key={sym}
                    onClick={() => fetchPE(sym)}
                    disabled={loading}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                      ticker === sym
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 text-foreground border-border hover:bg-muted hover:border-primary/40'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stock Info Card */}
        {peData && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{peData.name}</h2>
                <p className="text-xs text-muted-foreground">{peData.symbol}</p>
              </div>
              {peData.price != null && (
                <div className="text-right">
                  <p className="text-lg font-bold text-foreground">₹{peData.price.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Current Price</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-muted/50 rounded-md p-2.5">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Trailing PE
                  <InfoHint title="Trailing PE" side="top" formula="price ÷ last 12 months' EPS">What you pay today for each rupee of profit the company has already earned. It is the primary input to the deployment signal.</InfoHint>
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {peData.trailing_pe != null ? peData.trailing_pe.toFixed(2) : 'N/A'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-md p-2.5">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Forward PE
                  <InfoHint title="Forward PE" side="top" formula="price ÷ next 12 months' estimated EPS" caveat="Based on analyst estimates, which can be optimistic.">Price against expected future earnings. Lower than trailing PE implies analysts expect profits to grow.</InfoHint>
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {peData.forward_pe != null ? peData.forward_pe.toFixed(2) : 'N/A'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-md p-2.5">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  52W Range
                  <InfoHint title="52-week range" side="top">The lowest and highest traded price over the past year. The signal below scores where today's price sits inside this band — near the low is treated as a margin of safety.</InfoHint>
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {peData.fifty_two_week_low != null ? `₹${peData.fifty_two_week_low.toFixed(0)}` : '?'} – {peData.fifty_two_week_high != null ? `₹${peData.fifty_two_week_high.toFixed(0)}` : '?'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-md p-2.5">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Market Cap
                  <InfoHint title="Market capitalisation" side="top" formula="share price × shares outstanding">Total equity value of the company. Useful as a size/liquidity check — small caps swing far harder than the PE alone suggests.</InfoHint>
                </p>
                <p className="text-sm font-semibold text-foreground">{formatMarketCap(peData.market_cap)}</p>
              </div>
            </div>


            {/* Manual PE Input (shown when API can't fetch PE) */}
            {fetchedPE == null && (
              <div className="bg-muted/30 border border-dashed border-border rounded-md p-3">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  PE not available via API — enter manually
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={manualPE}
                    onChange={e => setManualPE(e.target.value)}
                    placeholder="e.g. 22.5"
                    className="w-32 px-3 py-1.5 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground self-center">
                    Look up PE on <a href={`https://finance.yahoo.com/quote/${peData.symbol}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Yahoo Finance</a> or <a href={`https://www.google.com/search?q=${peData.symbol}+PE+ratio`} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Google</a>
                  </span>
                </div>
              </div>
            )}

            {/* Active Recommendation */}
            {pe != null && (
              <div className={`border rounded-lg p-4 ${strategies[activeIdx].bgClass}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={strategies[activeIdx].colorClass}>{strategies[activeIdx].icon}</span>
                  <span className={`text-sm font-bold ${strategies[activeIdx].colorClass}`}>
                    Signal: {strategies[activeIdx].signal}
                  </span>
                  <InfoHint title="Headline signal" side="bottom" caveat="PE alone ignores sector, growth and market regime — see the decomposition below.">
                    The cheat-sheet band this ticker's PE falls into, with the matching deployment action.
                  </InfoHint>
                </div>

                <p className="text-sm text-foreground font-medium">
                  PE {pe.toFixed(2)} → <span className="font-bold">{strategies[activeIdx].action}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Expected 3-year returns: {strategies[activeIdx].returns}
                </p>
              </div>
            )}
          </div>
        )}

        {/* SHAP-style Signal Decomposition */}
        {signal && <SignalDecomposition signal={signal} />}



        {/* Strategy Cheat Sheet */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
              PE Deployment Cheat Sheet
              <InfoHint title="Deployment cheat sheet" side="bottom" caveat="A blunt heuristic. The multi-factor signal above is the more reliable read for a single stock.">
                A simple rule-of-thumb mapping from valuation level to how much fresh capital to deploy. Historically, buying when valuations are depressed has produced the strongest multi-year returns; the highlighted row is the band the current PE falls into.
              </InfoHint>
            </h3>
            <p className="text-xs text-muted-foreground">Capital deployment strategy based on trailing PE ratio</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">PE Range</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Signal</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">3-Year Returns</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 transition-colors ${
                      i === activeIdx ? `${s.bgClass} ring-1 ring-inset` : 'hover:bg-muted/20'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{s.range}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.colorClass}`}>
                        {s.icon} {s.signal}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.returns}</td>
                    <td className="px-4 py-3 text-xs font-medium text-foreground">{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground text-center">
          This is a rule-of-thumb strategy guide, not financial advice. PE ratios vary by sector and market conditions. Always do your own research.
        </p>
      </div>
    </div>
  );
};

export default function DeploymentPlan() {
  return (
    <PrivacyProvider>
      <DeploymentPlanContent />
    </PrivacyProvider>
  );
}
