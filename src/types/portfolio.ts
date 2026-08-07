export interface Transaction {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  date: string; // ISO string
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
}

export interface CashSettings {
  liquidCash: number;
  vaultCash: number;
  pfBalance: number;
  creditCardDebt: number;
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
