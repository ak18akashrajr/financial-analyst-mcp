/**
 * Rough sector PE medians for Indian equities (editable — refresh quarterly).
 * Used as the benchmark in the deployment signal factor #1.
 * Source: aggregated sector medians as of FY26-27 (approximate).
 */

export interface SectorBenchmark {
  sector: string;
  medianPE: number;
  aliases: string[]; // symbol prefixes / substrings that map to this sector
}

export const SECTOR_BENCHMARKS: SectorBenchmark[] = [
  { sector: 'IT Services', medianPE: 26, aliases: ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM', 'MPHASIS', 'PERSISTENT', 'COFORGE'] },
  { sector: 'Banking (Private)', medianPE: 18, aliases: ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'IDFCFIRSTB'] },
  { sector: 'Banking (PSU)', medianPE: 8, aliases: ['SBIN', 'BANKBARODA', 'PNB', 'CANBK', 'UNIONBANK'] },
  { sector: 'FMCG', medianPE: 45, aliases: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'MARICO', 'GODREJCP', 'COLPAL', 'TATACONSUM'] },
  { sector: 'Auto', medianPE: 24, aliases: ['MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT', 'TVSMOTOR'] },
  { sector: 'Pharma', medianPE: 32, aliases: ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'TORNTPHARM'] },
  { sector: 'Energy / Oil & Gas', medianPE: 12, aliases: ['RELIANCE', 'ONGC', 'IOC', 'BPCL', 'HPCL', 'GAIL'] },
  { sector: 'Metals', medianPE: 14, aliases: ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'JINDALSTEL', 'NMDC', 'SAIL'] },
  { sector: 'Cement', medianPE: 28, aliases: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'ACC', 'DALBHARAT'] },
  { sector: 'Capital Goods', medianPE: 40, aliases: ['LT', 'SIEMENS', 'ABB', 'BHEL', 'HAVELLS', 'CUMMINSIND'] },
  { sector: 'Consumer Durables', medianPE: 55, aliases: ['TITAN', 'ASIANPAINT', 'BERGEPAINT', 'PIDILITIND', 'VOLTAS'] },
  { sector: 'Telecom', medianPE: 35, aliases: ['BHARTIARTL', 'IDEA'] },
  { sector: 'NBFC / Finance', medianPE: 22, aliases: ['BAJFINANCE', 'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE', 'ICICIPRULI', 'CHOLAFIN', 'MUTHOOTFIN'] },
  { sector: 'Power / Utilities', medianPE: 16, aliases: ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'ADANIGREEN'] },
  { sector: 'US Tech (Mega Cap)', medianPE: 30, aliases: ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'META', 'NVDA', 'AMZN', 'TSLA', 'AVGO'] },
  { sector: 'US Broad Market', medianPE: 22, aliases: ['SPY', 'VOO', 'QQQ', 'VTI', 'IVV'] },
];

// Nifty 50 broad median as universal fallback
export const NIFTY_MEDIAN_PE = 22;

// 10Y India G-Sec yield — used for earnings-yield vs risk-free comparison.
// Editable constant; ~7% as of FY26-27.
export const INDIA_10Y_GSEC_YIELD = 0.0695;

export function getSectorForSymbol(symbol: string): SectorBenchmark {
  const up = symbol.toUpperCase().replace(/\.NS$|\.BO$/g, '');
  for (const b of SECTOR_BENCHMARKS) {
    if (b.aliases.includes(up)) return b;
  }
  return { sector: 'Broad Market', medianPE: NIFTY_MEDIAN_PE, aliases: [] };
}
