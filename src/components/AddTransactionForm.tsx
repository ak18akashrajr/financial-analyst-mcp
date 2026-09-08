import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Transaction } from '@/types/portfolio';

interface Props {
  transactions: Transaction[];
  onAdd: (txn: { symbol: string; type: 'BUY' | 'SELL'; quantity: number; price: number }) => void;
}

const MAX_SUGGESTIONS = 8;

export function AddTransactionForm({ transactions, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Every symbol ever seen in the ledger, not just currently-held ones — a
  // fully sold-off position should still autocomplete if you buy back in.
  const knownSymbols = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.symbol))).sort(),
    [transactions]
  );

  const suggestions = useMemo(() => {
    const query = symbol.trim().toUpperCase();
    if (!query) return knownSymbols.slice(0, MAX_SUGGESTIONS);
    return knownSymbols.filter((s) => s.includes(query)).slice(0, MAX_SUGGESTIONS);
  }, [knownSymbols, symbol]);

  const selectSuggestion = (value: string) => {
    setSymbol(value);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const handleSymbolKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    const prc = parseFloat(price);
    if (!symbol.trim() || isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) return;
    onAdd({ symbol: symbol.trim().toUpperCase(), type, quantity: qty, price: prc });
    setSymbol('');
    setQuantity('');
    setPrice('');
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <Plus className="w-4 h-4" /> Add Transaction
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">New Transaction</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="relative col-span-2 sm:col-span-1">
          <input
            placeholder="Symbol (e.g. INFY.NS)"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setShowSuggestions(true);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Delay so a click on a suggestion registers before the list unmounts.
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={handleSymbolKeyDown}
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
            autoComplete="off"
            required
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border border-border bg-popover shadow-md">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus so blur doesn't close the list first
                      selectSuggestion(s);
                    }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={`w-full text-left px-3 py-1.5 text-sm ${
                      i === highlightedIndex ? 'bg-secondary text-foreground' : 'text-foreground hover:bg-secondary'
                    }`}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'BUY' | 'SELL')}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
        >
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <input
          type="number"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
          min="0.01"
          step="any"
          required
        />
        <input
          type="number"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
          min="0.01"
          step="any"
          required
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Add
        </button>
      </div>
    </form>
  );
}
