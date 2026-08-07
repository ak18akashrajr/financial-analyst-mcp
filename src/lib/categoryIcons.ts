import {
  TrendingUp, Landmark, Building2, Coins, Home, Globe,
  BookOpen, Bitcoin, Shield, Package, BarChart3, Box,
  Link, Banknote, CircleDot
} from 'lucide-react';


const iconMap: Record<string, typeof TrendingUp> = {
  'Cash': Banknote,
  'Stocks': TrendingUp,
  'Mutual Funds': Landmark,
  'Fixed Deposits': Building2,
  'Gold & Silver': Coins,
  'Real Estate': Home,
  'US Stocks / ETFs': Globe,
  'PPF / EPF': BookOpen,
  'Crypto': Bitcoin,
  'NPS': Shield,
  'Custom Assets': Package,
  'Index': BarChart3,
  'Commodity': Box,
  'Bonds': Link,
  'FDs': Building2,
  'Equity': TrendingUp,
  'ETF': CircleDot,
  'Gold': Coins,
};

export function getCategoryIcon(category: string) {
  return iconMap[category] || Banknote;
}
