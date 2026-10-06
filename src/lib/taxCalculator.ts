import type { Transaction, Category } from '@/types/portfolio';
import { parseLocalDate } from './dateUtils';

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

/** A held symbol deliberately left out of the capital-gains report, and why. */
export interface ExcludedHolding {
  symbol: string;
  category: Category;
  reason: string;
}

export interface TaxReport {
  holdings: SymbolTaxSummary[];
  /** Holdings with no capital-gains treatment (FDs, PF, NPS) — shown as a note, never taxed here. */
  excluded: ExcludedHolding[];
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
 * Categories with no capital-gains treatment at all, so a "tax if sold today" estimate is meaningless for
 * them: FD / deposit interest is taxed yearly as ordinary income, PPF/EPF are exempt, and NPS is taxed on
 * withdrawal under its own rules (60% lump sum tax-free, 40% annuitised). They are listed on the report as
 * `excluded` rather than silently dropped — previously they fell to the 24-month / 30% default and showed
 * a made-up tax bill.
 */
const NO_CAPITAL_GAINS: Partial<Record<Category, string>> = {
  'Fixed Deposits': 'Interest is taxed yearly as income at your slab rate — not a capital gain',
  FDs: 'Interest is taxed yearly as income at your slab rate — not a capital gain',
  'PPF / EPF': 'Exempt from capital gains (PPF/EPF maturity is tax-free)',
  NPS: 'Not a capital gain — taxed on withdrawal (60% lump sum tax-free, 40% annuity taxed as income)',
};

/** Reason a category is left out of the capital-gains report, or null if it belongs in it. */
export function capitalGainsExclusionReason(category: Category): string | null {
  return NO_CAPITAL_GAINS[category] ?? null;
}

/**
 * Determines holding period threshold (in days) for long-term classification.
 * Based on Indian tax law FY 2026-27 (unchanged from FY 2025-26 per Budget 2026).
 *
 * - 12 months: listed equity / equity funds, and — by assumption about what is held — listed Gold/Silver
 *   ETFs (tickers priced through Yahoo are listed instruments) and listed bonds.
 * - Never: crypto / virtual digital assets are a flat 30% regime (Sec 115BBH) with no long-term class.
 * - 24 months: everything else — US stocks / ETFs (foreign shares are treated as unlisted), real estate,
 *   physical gold and gold funds-of-funds, and any custom asset.
 *
 * Gold is category-level, so a physical-gold or gold fund-of-funds holding tagged "Gold" is under-classified
 * as long-term at 12-24 months; the Taxes page says so. Whether a bond is listed also can't be told from its
 * category — see the page's CA note.
 */
function getLTThresholdDays(category: Category): number {
  switch (category) {
    case 'Stocks':
    case 'Equity':
    case 'ETF':
    case 'Index':
    case 'Mutual Funds':
    case 'Gold':
    case 'Gold & Silver':
    case 'Bonds':
      return 365; // 12 months
    case 'Crypto':
      return Number.POSITIVE_INFINITY; // never long-term: flat 30% (Sec 115BBH)
    case 'US Stocks / ETFs':
    case 'Commodity':
    case 'Real Estate':
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
    case 'Stocks':
    case 'Equity':
    case 'ETF':
    case 'Index':
    case 'Mutual Funds':
      return 0.20; // 20% flat
    case 'Crypto':
      return 0.30; // flat 30% on all gains, no slab, no set-off
    default:
      return 0.30; // slab rate (upper estimate)
  }
}

/**
 * LTCG rate: 12.5% for all asset classes (post Budget 2024)
 */
function getLTCGRate(category: Category): number {
  // Crypto never reaches the long-term branch (threshold is infinite); 30% is what it would be if it did.
  return category === 'Crypto' ? 0.30 : 0.125;
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
    // lot.date is a bare Postgres DATE string ('YYYY-MM-DD', no time/offset) — parse it as LOCAL
    // midnight (matching `today`, a real local Date instant), not UTC midnight. Otherwise, in a
    // timezone ahead of UTC, holdingDays is undercounted by the local/UTC offset, which can flip
    // isLongTerm for a lot sitting within that margin of the LTCG/STCG threshold. See TODO.md's
    // High Priority Action Items and dateUtils.ts's parseLocalDate doc comment.
    const buyDate = parseLocalDate(lot.date);
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
  const excluded: ExcludedHolding[] = [];
  let totalSTCG = 0;
  let totalLTCG = 0;
  let equityLTCG = 0; // eligible for exemption

  for (const [symbol, txns] of Object.entries(bySymbol)) {
    const price = currentPrices[symbol] || 0;
    const category = symbolMetadata[symbol]?.category || 'Equity';
    const exclusionReason = capitalGainsExclusionReason(category);
    if (exclusionReason) {
      // Only list it if something is still held — a fully-sold FD isn't a current holding to mention.
      if (computeLotsForSymbol(txns, price, category, today).some(l => l.quantity > 0)) {
        excluded.push({ symbol, category, reason: exclusionReason });
      }
      continue;
    }
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
    excluded,
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

/**
 * Lots currently sitting below cost — candidates for tax-loss harvesting before FY-end. Sorted by
 * loss size descending (biggest loss first) since that's the order you'd typically triage them in.
 * See docs/feature-ideas.md #3.
 */
export function getHarvestableLots(report: TaxReport): TaxLot[] {
  return report.holdings
    .flatMap(h => h.lots)
    .filter(lot => lot.gain < 0)
    .sort((a, b) => a.gain - b.gain);
}

/**
 * Whether `symbol` has ever had both a BUY and a SELL transaction land on the same calendar day.
 * Used to flag the wash-sale-style caveat next to a harvestable lot: India has no formal wash-sale
 * rule, but selling to realize a loss and re-buying the same stock the same day is the pattern
 * that most invites scrutiny (no real change in economic position). This only detects that the
 * pattern has happened *before* for this symbol — it can't predict a future re-buy, and since
 * AddTransactionForm has no date picker (every transaction is stamped with insert time), "same
 * day" here really means "same day the transactions were entered," which is the best signal
 * available without a user-editable transaction date.
 */
export function hasSameDayReentry(symbol: string, transactions: Transaction[]): boolean {
  const daysWithActivity = new Map<string, { buy: boolean; sell: boolean }>();
  for (const t of transactions) {
    if (t.symbol !== symbol) continue;
    const day = t.date.slice(0, 10);
    const entry = daysWithActivity.get(day) ?? { buy: false, sell: false };
    if (t.type === 'BUY') entry.buy = true; else entry.sell = true;
    daysWithActivity.set(day, entry);
  }
  for (const { buy, sell } of daysWithActivity.values()) {
    if (buy && sell) return true;
  }
  return false;
}
