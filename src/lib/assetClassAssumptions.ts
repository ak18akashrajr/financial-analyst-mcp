/**
 * Per-asset-class expected return & volatility assumptions.
 * Sources: long-run historical means (Nifty 50 TR ~12% w/ ~18% vol,
 * CRISIL Composite Bond ~7%/4%, Gold INR ~8%/15%, S&P 500 in INR ~10%/16%,
 * PPF/EPF administered rate 7.1%, Crypto BTC ~20%/60%).
 * These are ASSUMPTIONS, not forecasts — flagged transparently in the UI.
 */

export interface AssetAssumption {
  expectedReturn: number; // decimal, e.g. 0.12
  volatility: number;     // annualized stdev, decimal
  taxable: boolean;       // whether STCG/LTCG applies to redemption
}

export const ASSET_ASSUMPTIONS: Record<string, AssetAssumption> = {
  'Stocks':            { expectedReturn: 0.12, volatility: 0.18, taxable: true },
  'Equity':            { expectedReturn: 0.12, volatility: 0.18, taxable: true },
  'Index':             { expectedReturn: 0.11, volatility: 0.17, taxable: true },
  'ETF':               { expectedReturn: 0.11, volatility: 0.17, taxable: true },
  'Mutual Funds':      { expectedReturn: 0.11, volatility: 0.16, taxable: true },
  'US Stocks / ETFs':  { expectedReturn: 0.10, volatility: 0.16, taxable: true },
  'Bonds':             { expectedReturn: 0.07, volatility: 0.04, taxable: true },
  'Fixed Deposits':    { expectedReturn: 0.065, volatility: 0.005, taxable: true },
  'FDs':               { expectedReturn: 0.065, volatility: 0.005, taxable: true },
  'Gold':              { expectedReturn: 0.08, volatility: 0.15, taxable: true },
  'Gold & Silver':     { expectedReturn: 0.08, volatility: 0.15, taxable: true },
  'Commodity':         { expectedReturn: 0.07, volatility: 0.20, taxable: true },
  'Real Estate':       { expectedReturn: 0.08, volatility: 0.10, taxable: true },
  'Crypto':            { expectedReturn: 0.20, volatility: 0.60, taxable: true },
  'PPF / EPF':         { expectedReturn: 0.071, volatility: 0.0, taxable: false },
  'NPS':               { expectedReturn: 0.09, volatility: 0.10, taxable: false },
  'Cash':              { expectedReturn: 0.04, volatility: 0.0, taxable: false },
  'Custom Assets':     { expectedReturn: 0.08, volatility: 0.12, taxable: true },
};

const DEFAULT: AssetAssumption = { expectedReturn: 0.10, volatility: 0.14, taxable: true };

export function getAssumption(category?: string | null): AssetAssumption {
  if (!category) return DEFAULT;
  return ASSET_ASSUMPTIONS[category] ?? DEFAULT;
}

export interface ExposureWeight { label: string; weight: number; }

/**
 * Portfolio-weighted expected return & volatility.
 * Volatility uses simple weighted average of asset-class vols (ignores correlations
 * — flagged as a first-pass approximation; a covariance model would be v2).
 */
export function weightedAssumptions(weights: ExposureWeight[]): {
  expectedReturn: number;
  volatility: number;
} {
  const totalW = weights.reduce((s, w) => s + w.weight, 0);
  if (totalW <= 0) return { expectedReturn: DEFAULT.expectedReturn, volatility: DEFAULT.volatility };
  let r = 0, v = 0;
  for (const w of weights) {
    const a = getAssumption(w.label);
    const nw = w.weight / totalW;
    r += a.expectedReturn * nw;
    v += a.volatility * nw;
  }
  return { expectedReturn: r, volatility: v };
}
