import type { Transaction, Category } from '@/types/portfolio';

export interface TaxLot {
  buyDate: string;
  quantity: number;
  buyPrice: number;
  currentPrice: number;
  holdingDays: number;
  isLongTerm: boolean;
  gain: number;
  taxRate: number;
  taxAmount: number;
  category: Category;
  symbol: string;
}

export interface SymbolTaxSummary {
  symbol: string;
  category: Category;
  lots: TaxLot[];
  totalQuantity: number;
  totalInvested: number;
  totalCurrentValue: number;
  totalGain: number;
  stcgAmount: number;
  ltcgAmount: number;
  stcgTax: number;
  ltcgTax: number;
}

export interface TaxReport {
  holdings: SymbolTaxSummary[];
  totalSTCG: number;
  totalLTCG: number;
  ltcgExemption: number;
  taxableSTCG: number;
  taxableLTCG: number;
  stcgTax: number;
  ltcgTax: number;
  totalTax: number;
  cess: number;
  totalTaxWithCess: number;
}

const LTCG_EXEMPTION = 125000; // ₹1.25 lakh
const CESS_RATE = 0.04; // 4% Health & Education Cess

/**
 * Determines holding period threshold (in days) for long-term classification.
 * Based on Indian tax law FY 2026-27 (unchanged from FY 2025-26 per Budget 2026).
 */
function getLTThresholdDays(category: Category): number {
  switch (category) {
    case 'Equity':
    case 'ETF':
    case 'Index':
    case 'Mutual Funds':
      return 365; // 12 months
    case 'Gold':
    case 'Commodity':
    case 'Bonds':
    case 'Real Estate':
    case 'Crypto':
    case 'FDs':
    default:
      return 730; // 24 months
  }
}

/**
 * Gets STCG tax rate for the category.
 * Listed equity/equity MF: 20% flat (Section 111A)
 * Others: slab rate (we use 30% as upper estimate)
 */
function getSTCGRate(category: Category): number {
  switch (category) {
    case 'Equity':
    case 'ETF':
    case 'Index':
    case 'Mutual Funds':
      return 0.20; // 20% flat
    default:
      return 0.30; // slab rate (upper estimate)
  }
}

/**
 * LTCG rate: 12.5% for all asset classes (post Budget 2024)
 */
function getLTCGRate(_category: Category): number {
  return 0.125;
}

/**
 * Whether the category qualifies for the ₹1.25L LTCG exemption under Section 112A
 */
function qualifiesForLTCGExemption(category: Category): boolean {
  return ['Equity', 'ETF', 'Index', 'Mutual Funds', 'Stocks'].includes(category);
}

/**
 * FIFO-based tax lot computation for a single symbol.
 */
function computeLotsForSymbol(
  transactions: Transaction[],
  currentPrice: number,
  category: Category,
  today: Date
): TaxLot[] {
  // Sort by date ascending for FIFO
  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Build FIFO queue of buy lots
  const buyLots: { date: string; quantity: number; price: number }[] = [];

  for (const txn of sorted) {
    if (txn.type === 'BUY') {
      buyLots.push({ date: txn.date, quantity: txn.quantity, price: txn.price });
    } else {
      // SELL: consume from oldest lots first (FIFO)
      let remaining = txn.quantity;
      while (remaining > 0 && buyLots.length > 0) {
        const lot = buyLots[0];
        if (lot.quantity <= remaining) {
          remaining -= lot.quantity;
          buyLots.shift();
        } else {
          lot.quantity -= remaining;
          remaining = 0;
        }
      }
    }
  }

  // Remaining buy lots are current holdings — compute tax for hypothetical sale today
  const thresholdDays = getLTThresholdDays(category);
  const stcgRate = getSTCGRate(category);
  const ltcgRate = getLTCGRate(category);

  return buyLots.map(lot => {
    const buyDate = new Date(lot.date);
    const holdingDays = Math.floor((today.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24));
    const isLongTerm = holdingDays > thresholdDays;
    const gain = (currentPrice - lot.price) * lot.quantity;
    const taxRate = isLongTerm ? ltcgRate : stcgRate;
    // Note: exemption is applied at aggregate level, not per-lot
    const taxAmount = gain > 0 ? gain * taxRate : 0;

    return {
      buyDate: lot.date,
      quantity: lot.quantity,
      buyPrice: lot.price,
      currentPrice,
      holdingDays,
      isLongTerm,
      gain,
      taxRate,
      taxAmount,
      category,
      symbol: '',
    };
  });
}

export function generateTaxReport(
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  symbolMetadata: Record<string, { category?: Category }>,
): TaxReport {
  const today = new Date();

  // Group transactions by symbol
  const bySymbol: Record<string, Transaction[]> = {};
  for (const txn of transactions) {
    if (!bySymbol[txn.symbol]) bySymbol[txn.symbol] = [];
    bySymbol[txn.symbol].push(txn);
  }

  const holdings: SymbolTaxSummary[] = [];
  let totalSTCG = 0;
  let totalLTCG = 0;
  let equityLTCG = 0; // eligible for exemption

  for (const [symbol, txns] of Object.entries(bySymbol)) {
    const price = currentPrices[symbol] || 0;
    const category = symbolMetadata[symbol]?.category || 'Equity';
    const lots = computeLotsForSymbol(txns, price, category, today);

    // Tag symbol on each lot
    lots.forEach(l => (l.symbol = symbol));

    const totalQuantity = lots.reduce((s, l) => s + l.quantity, 0);
    if (totalQuantity <= 0) continue;

    const totalInvested = lots.reduce((s, l) => s + l.buyPrice * l.quantity, 0);
    const totalCurrentValue = totalQuantity * price;
    const totalGain = totalCurrentValue - totalInvested;

    const stcgAmount = lots.filter(l => !l.isLongTerm).reduce((s, l) => s + Math.max(0, l.gain), 0);
    const ltcgAmount = lots.filter(l => l.isLongTerm).reduce((s, l) => s + Math.max(0, l.gain), 0);
    const stcgTax = lots.filter(l => !l.isLongTerm).reduce((s, l) => s + l.taxAmount, 0);
    const ltcgTax = lots.filter(l => l.isLongTerm).reduce((s, l) => s + l.taxAmount, 0);

    totalSTCG += stcgAmount;
    totalLTCG += ltcgAmount;
    if (qualifiesForLTCGExemption(category)) equityLTCG += ltcgAmount;

    holdings.push({
      symbol, category, lots, totalQuantity, totalInvested,
      totalCurrentValue, totalGain, stcgAmount, ltcgAmount, stcgTax, ltcgTax,
    });
  }

  // Apply ₹1.25L LTCG exemption on equity-type holdings
  const ltcgExemption = Math.min(equityLTCG, LTCG_EXEMPTION);
  const taxableSTCG = totalSTCG;
  const taxableLTCG = Math.max(0, totalLTCG - ltcgExemption);

  // Recompute aggregate tax after exemption
  const stcgTax = holdings.reduce((s, h) => s + h.stcgTax, 0);
  const ltcgTax = Math.max(0, taxableLTCG * 0.125);

  const totalTax = stcgTax + ltcgTax;
  const cess = totalTax * CESS_RATE;
  const totalTaxWithCess = totalTax + cess;

  return {
    holdings,
    totalSTCG,
    totalLTCG,
    ltcgExemption,
    taxableSTCG,
    taxableLTCG,
    stcgTax,
    ltcgTax,
    totalTax,
    cess,
    totalTaxWithCess,
  };
}
