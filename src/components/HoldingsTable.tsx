import { useState } from 'react';
import type { DerivedHolding, Geography, Category } from '@/types/portfolio';
import { TransactionHistory } from './TransactionHistory';
import { usePrivacy } from '@/contexts/PrivacyContext';


function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const GEOGRAPHIES: Geography[] = ['India', 'US', 'Global'];
const CATEGORIES: Category[] = ['Stocks', 'Mutual Funds', 'Fixed Deposits', 'Gold & Silver', 'Real Estate', 'US Stocks / ETFs', 'PPF / EPF', 'Crypto', 'NPS', 'Custom Assets', 'Index', 'Commodity', 'Bonds', 'FDs', 'Equity', 'ETF', 'Gold'];

interface Props {
  holdings: DerivedHolding[];
  onUpdatePrice: (symbol: string, price: number) => void;
  onUpdateTransaction: (id: string, updates: { quantity?: number; price?: number }) => void;
  onDeleteTransaction: (id: string) => void;
  onUpdateMetadata: (symbol: string, geography: string, sector: string) => void;
}

export function HoldingsTable({ holdings, onUpdatePrice, onUpdateTransaction, onDeleteTransaction, onUpdateMetadata }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const handlePriceSave = (symbol: string) => {
    const val = parseFloat(priceInput);
    if (!isNaN(val) && val > 0) {
      onUpdatePrice(symbol, val);
    }
    setEditingPrice(null);
    setPriceInput('');
  };

  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No holdings yet. Add transactions to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left p-3 font-medium text-muted-foreground">Symbol</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Avg Price</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Current Price</th>
              <th className="text-center p-3 font-medium text-muted-foreground">Geo</th>
              <th className="text-center p-3 font-medium text-muted-foreground">Category</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Principal Allocated</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Current</th>
              <th className="text-right p-3 font-medium text-muted-foreground">P&L</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <>
                <tr
                  key={h.symbol}
                  className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setExpandedSymbol(expandedSymbol === h.symbol ? null : h.symbol)}
                >
                  <td className="p-3 font-medium text-foreground">{h.symbol}</td>
                  <td className="p-3 text-right text-foreground">{h.totalQuantity}</td>
                  <td className="p-3 text-right text-foreground">{fmt(h.avgPrice)}</td>
                  <td className="p-3 text-right">
                    {editingPrice === h.symbol ? (
                      <input
                        type="number"
                        className="w-24 px-2 py-1 border border-input rounded text-right bg-background text-foreground text-sm"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        onBlur={() => handlePriceSave(h.symbol)}
                        onKeyDown={(e) => e.key === 'Enter' && handlePriceSave(h.symbol)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="text-primary cursor-pointer hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPrice(h.symbol);
                          setPriceInput(h.currentPrice.toString());
                        }}
                      >
                        {h.currentPrice > 0 ? fmt(h.currentPrice) : 'Set price'}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={h.geography || 'India'}
                      onChange={(e) => onUpdateMetadata(h.symbol, e.target.value, h.category || 'Equity')}
                      className="px-1.5 py-1 text-xs border border-input rounded bg-background text-foreground"
                    >
                      {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={h.category || 'Equity'}
                      onChange={(e) => onUpdateMetadata(h.symbol, h.geography || 'India', e.target.value)}
                      className="px-1.5 py-1 text-xs border border-input rounded bg-background text-foreground"
                    >
                      {CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="p-3 text-right text-foreground">{fmt(h.totalInvested)}</td>
                  <td className="p-3 text-right text-foreground">{fmt(h.currentValue)}</td>
                  <td className={`p-3 text-right font-medium ${h.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {fmt(h.pnl)} ({h.pnlPercent.toFixed(2)}%)
                  </td>
                </tr>
                {expandedSymbol === h.symbol && (
                  <tr key={`${h.symbol}-history`}>
                    <td colSpan={9} className="p-0 bg-muted/20">
                      <TransactionHistory
                        transactions={h.transactions}
                        onUpdate={onUpdateTransaction}
                        onDelete={onDeleteTransaction}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
