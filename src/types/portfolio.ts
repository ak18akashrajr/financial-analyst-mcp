export interface Transaction {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  date: string; // ISO string
  // Set on every real transaction (usePortfolio.ts requires a specific member selected before
  // inserting one) — optional here only so pure-function tests/fixtures across the repo that
  // don't care which member a transaction belongs to (xirr, cost-basis, tax calculations, etc.)
  // don't all need a throwaway value.
  familyMemberId?: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  createdAt: string;
}

// A record of a deleted family member, kept after the member row itself is gone — see
// supabase/migrations/20260918100000_add_family_member_deletions.sql. memberName/
// memberRelationship are a point-in-time snapshot, not a live join, since the member no longer
// exists by the time this is read. deletedBy is free text (the person at the keyboard enters it
// at delete time) — there's no separate "acting user" identity to attribute this to in this
// single-login app.
export interface FamilyMemberDeletion {
  id: string;
  memberId: string;
  memberName: string;
  memberRelationship: string;
  reason: string;
  deletedBy: string;
  deletedAt: string;
}

export interface DerivedHolding {
  symbol: string;
  totalQuantity: number;
  totalInvested: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  transactions: Transaction[];
  geography?: string;
  category?: string;
}

export interface PortfolioSummary {
  investedValue: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
  totalPortfolioValue: number;
  xirr: number | null; // annualized return %, null if not calculable
  // Same calculation as `xirr`, but excludes any symbol tagged category
  // 'PPF / EPF' in symbol_metadata. Distinct from `xirr` only if a real,
  // transaction-backed holding is tagged PPF/EPF — the manual PF balance in
  // cash_settings never affects either number, since it has no dated
  // contribution history to build cash flows from. See docs/xirr-breakdown.md.
  xirrExPf: number | null;
}

export interface CashSettings {
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
}

// Current calendar month's auto-tracked income/expense totals, derived from
// Operating Cash / Cash Reserve balance deltas — see src/lib/expenseIncomeRatio.ts.
export interface MonthlyCashflow {
  totalIncome: number;
  totalExpense: number;
}


export interface CurrentPrices {
  [symbol: string]: number;
}

export type Geography = 'India' | 'US' | 'Global';
export type Category = 'Stocks' | 'Mutual Funds' | 'Fixed Deposits' | 'Gold & Silver' | 'Real Estate' | 'US Stocks / ETFs' | 'PPF / EPF' | 'Crypto' | 'NPS' | 'Custom Assets' | 'Index' | 'Commodity' | 'Bonds' | 'FDs' | 'Equity' | 'ETF' | 'Gold';

export interface SymbolMetadata {
  symbol: string;
  geography: Geography;
  category: Category;
}

export interface ExposureBreakdown {
  label: string;
  value: number;
  percent: number;
}
