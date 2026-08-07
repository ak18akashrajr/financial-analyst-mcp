import { useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Props {
  onAdd: (txn: { symbol: string; type: 'BUY' | 'SELL'; quantity: number; price: number }) => void;
}

export function AddTransactionForm({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    const prc = parseFloat(price);
    if (!symbol.trim() || isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) return;
    onAdd({ symbol: symbol.trim().toUpperCase(), type, quantity: qty, price: prc });
    setSymbol('');
    setQuantity('');
    setPrice('');
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
        <input
          placeholder="Symbol (e.g. INFY.NS)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground col-span-2 sm:col-span-1"
          required
        />
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
