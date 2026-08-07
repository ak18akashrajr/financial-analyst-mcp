/**
 * SHAP-style transparent decomposition of the PE-based deployment signal.
 * Each factor returns weight × normalized-score → points contributing to a
 * -100..+100 total. Positive = BUY bias, negative = AVOID bias.
 *
 * Every factor is auditable: it exposes its raw value, benchmark, and
 * contribution so the user never has to trust a single opaque verdict.
 */

import { getSectorForSymbol, INDIA_10Y_GSEC_YIELD, NIFTY_MEDIAN_PE } from './sectorBenchmarks';

export interface PEInputs {
  symbol: string;
  price: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  dividendYield: number | null; // decimal (0.015 = 1.5%)
  marketCape?: number | null; // NIFTY Shiller PE
  marketCapeMedian?: number | null; // long-term NIFTY CAPE median
}

export type FactorDirection = 'positive' | 'negative' | 'neutral';

export interface SignalFactor {
  key: string;
  name: string;
  value: string; // formatted current value
  benchmark: string; // formatted benchmark
  weight: number; // 0..1 — how much this factor is worth of the total
  points: number; // signed contribution to score (-weight*100 .. +weight*100)
  direction: FactorDirection;
  note: string; // one-line rationale
  available: boolean; // false = input missing → 0 points, drags confidence
}

export interface SignalResult {
  score: number; // -100..+100
  verdict: 'STRONG BUY' | 'BUY' | 'HOLD' | 'AVOID' | 'STRONG AVOID';
  verdictColor: string;
  confidence: number; // 0..1
  factors: SignalFactor[];
  sector: string;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ── Factor 1: Trailing PE vs sector median ──
function factorSectorPE(inputs: PEInputs): SignalFactor {
  const sector = getSectorForSymbol(inputs.symbol);
  const pe = inputs.trailingPE;
  const weight = 0.28;
  if (pe == null) {
    return { key: 'sectorPE', name: 'PE vs sector median', value: 'n/a', benchmark: `${sector.sector}: ${sector.medianPE}`, weight, points: 0, direction: 'neutral', note: 'Trailing PE not available.', available: false };
  }
  // If PE is 30% below sector median → +weight*100. 30% above → -weight*100.
  const deviation = (sector.medianPE - pe) / sector.medianPE; // positive when cheap
  const norm = clamp(deviation / 0.3, -1, 1);
  const points = norm * weight * 100;
  return {
    key: 'sectorPE',
    name: 'PE vs sector median',
    value: pe.toFixed(2),
    benchmark: `${sector.sector}: ${sector.medianPE}`,
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: pe < sector.medianPE
      ? `${(Math.abs(deviation) * 100).toFixed(0)}% cheaper than sector peers.`
      : `${(Math.abs(deviation) * 100).toFixed(0)}% richer than sector peers.`,
    available: true,
  };
}

// ── Factor 2: Forward PE vs Trailing PE (growth signal) ──
function factorGrowth(inputs: PEInputs): SignalFactor {
  const weight = 0.14;
  const t = inputs.trailingPE;
  const f = inputs.forwardPE;
  if (t == null || f == null) {
    return { key: 'growth', name: 'Forward vs Trailing PE (growth)', value: 'n/a', benchmark: '—', weight, points: 0, direction: 'neutral', note: 'Forward PE not available.', available: false };
  }
  // Forward < Trailing → earnings expected to grow → positive.
  const growthPct = (t - f) / t; // 0.10 = 10% earnings growth priced in
  const norm = clamp(growthPct / 0.20, -1, 1); // ±20% growth → full weight
  const points = norm * weight * 100;
  return {
    key: 'growth',
    name: 'Forward vs Trailing PE (growth)',
    value: `${f.toFixed(2)} vs ${t.toFixed(2)}`,
    benchmark: 'Fwd < TTM = growth',
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: growthPct > 0
      ? `${(growthPct * 100).toFixed(1)}% earnings growth priced in.`
      : `Earnings expected to shrink by ${(Math.abs(growthPct) * 100).toFixed(1)}%.`,
    available: true,
  };
}

// ── Factor 3: Price vs 52W range (percentile) ──
function factor52W(inputs: PEInputs): SignalFactor {
  const weight = 0.14;
  const { price, fiftyTwoWeekHigh: hi, fiftyTwoWeekLow: lo } = inputs;
  if (price == null || hi == null || lo == null || hi === lo) {
    return { key: '52w', name: 'Price vs 52W range', value: 'n/a', benchmark: '—', weight, points: 0, direction: 'neutral', note: '52W range not available.', available: false };
  }
  const pct = (price - lo) / (hi - lo); // 0 = at 52W low, 1 = at high
  // Near lows = positive (buy the dip); near highs = mildly negative.
  const norm = clamp(1 - 2 * pct, -1, 1); // pct=0 → +1, pct=0.5 → 0, pct=1 → −1
  const points = norm * weight * 100;
  return {
    key: '52w',
    name: 'Price vs 52W range',
    value: `${(pct * 100).toFixed(0)}th pct`,
    benchmark: 'Low = buy zone',
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: pct < 0.3
      ? 'Trading near 52W lows — mean-reversion setup.'
      : pct > 0.7
        ? 'Trading near 52W highs — momentum, but limited margin of safety.'
        : 'Mid-range — no directional edge.',
    available: true,
  };
}

// ── Factor 4: Earnings yield vs 10Y G-Sec (Equity Risk Premium) ──
function factorERP(inputs: PEInputs): SignalFactor {
  const weight = 0.20;
  const pe = inputs.trailingPE;
  if (pe == null || pe <= 0) {
    return { key: 'erp', name: 'Earnings yield vs 10Y G-Sec', value: 'n/a', benchmark: `${(INDIA_10Y_GSEC_YIELD * 100).toFixed(2)}%`, weight, points: 0, direction: 'neutral', note: 'PE required for earnings yield.', available: false };
  }
  const earningsYield = 1 / pe;
  const erp = earningsYield - INDIA_10Y_GSEC_YIELD; // positive = equity paying more than risk-free
  const norm = clamp(erp / 0.04, -1, 1); // ±4% ERP → full weight
  const points = norm * weight * 100;
  return {
    key: 'erp',
    name: 'Earnings yield vs 10Y G-Sec',
    value: `${(earningsYield * 100).toFixed(2)}%`,
    benchmark: `G-Sec ${(INDIA_10Y_GSEC_YIELD * 100).toFixed(2)}%`,
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: erp > 0
      ? `Equity risk premium of ${(erp * 100).toFixed(2)}% — compensated for equity risk.`
      : `Equity yields ${Math.abs(erp * 100).toFixed(2)}% less than risk-free — poor risk/reward.`,
    available: true,
  };
}

// ── Factor 5: Dividend yield ──
function factorDividend(inputs: PEInputs): SignalFactor {
  const weight = 0.08;
  const dy = inputs.dividendYield;
  if (dy == null) {
    return { key: 'div', name: 'Dividend yield', value: 'n/a', benchmark: '~1.5% market avg', weight, points: 0, direction: 'neutral', note: 'Dividend yield not reported.', available: false };
  }
  const norm = clamp((dy - 0.015) / 0.03, -1, 1); // 1.5% baseline; +/-3% band
  const points = norm * weight * 100;
  return {
    key: 'div',
    name: 'Dividend yield',
    value: `${(dy * 100).toFixed(2)}%`,
    benchmark: '~1.5%',
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: dy > 0.03 ? 'High income cushion.' : dy < 0.005 ? 'Growth stock — no income cushion.' : 'Modest yield.',
    available: true,
  };
}

// ── Factor 6: Market regime (NIFTY Shiller PE) — universal overlay ──
function factorRegime(inputs: PEInputs): SignalFactor {
  const weight = 0.16;
  const cape = inputs.marketCape;
  const median = inputs.marketCapeMedian ?? 24;
  if (cape == null) {
    return { key: 'regime', name: 'Market regime (NIFTY CAPE)', value: 'n/a', benchmark: `Median ${median}`, weight, points: 0, direction: 'neutral', note: 'Set NIFTY Shiller PE to enable regime overlay.', available: false };
  }
  // Below median → cheap market → +. Above → expensive → −.
  const deviation = (median - cape) / median;
  const norm = clamp(deviation / 0.25, -1, 1); // ±25% around median → full weight
  const points = norm * weight * 100;
  const zone = cape < 20 ? 'Cheap' : cape < 25 ? 'Fair' : cape < 30 ? 'Expensive' : 'Bubble';
  return {
    key: 'regime',
    name: 'Market regime (NIFTY CAPE)',
    value: `${cape.toFixed(1)} · ${zone}`,
    benchmark: `Median ${median}`,
    weight,
    points,
    direction: points > 1 ? 'positive' : points < -1 ? 'negative' : 'neutral',
    note: `Broad market is ${zone.toLowerCase()} on a Shiller basis — scales conviction ${points >= 0 ? 'up' : 'down'}.`,
    available: true,
  };
}

export function computeSignal(inputs: PEInputs): SignalResult {
  const factors: SignalFactor[] = [
    factorSectorPE(inputs),
    factorGrowth(inputs),
    factor52W(inputs),
    factorERP(inputs),
    factorDividend(inputs),
    factorRegime(inputs),
  ];

  const score = factors.reduce((s, f) => s + f.points, 0);
  const availableWeight = factors.filter(f => f.available).reduce((s, f) => s + f.weight, 0);
  const confidence = availableWeight; // 0..1 (weights sum to 1.0 when all present)

  let verdict: SignalResult['verdict'];
  let verdictColor: string;
  if (score >= 40) { verdict = 'STRONG BUY'; verdictColor = 'text-emerald-600 bg-emerald-500/10 border-emerald-500/40'; }
  else if (score >= 15) { verdict = 'BUY'; verdictColor = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30'; }
  else if (score >= -15) { verdict = 'HOLD'; verdictColor = 'text-amber-500 bg-amber-500/10 border-amber-500/30'; }
  else if (score >= -40) { verdict = 'AVOID'; verdictColor = 'text-orange-500 bg-orange-500/10 border-orange-500/30'; }
  else { verdict = 'STRONG AVOID'; verdictColor = 'text-red-500 bg-red-500/10 border-red-500/40'; }

  return {
    score,
    verdict,
    verdictColor,
    confidence,
    factors,
    sector: getSectorForSymbol(inputs.symbol).sector,
  };
}
