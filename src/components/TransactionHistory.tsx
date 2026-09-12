import { useState } from 'react';
import type { Transaction } from '@/types/portfolio';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';

interface Props {
  transactions: Transaction[];
  onUpdate: (id: string, updates: { quantity?: number; price?: number }) => void;
  onDelete: (id: string) => void;
}

// How many rows render before the "Show more" control appears. This is the
// only place in the app that renders an unbounded transaction list — every
// other consumer either aggregates (holdings, exposure, XIRR) or is already
// bounded by construction (RecentActivity filters to the current month) — so
// it's the one list where a long SIP history actually costs DOM nodes.
//
// Display-only, deliberately: usePortfolio still fetches and derives the
// complete transaction set, because FIFO cost basis, XIRR and tax lots are all
// wrong without it. See TODO.md's paginate-transactions item.
export const TRANSACTION_PAGE_SIZE = 20;

export function TransactionHistory({ transactions, onUpdate, onDelete }: Props) {
  const { mask } = usePrivacy();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');
  // No reset effect needed: HoldingsTable keys this component per symbol
  // (`${h.symbol}-history`) and only mounts it for the expanded row, so
  // switching symbols remounts with a fresh count rather than inheriting the
  // previous holding's.
  const [visibleCount, setVisibleCount] = useState(TRANSACTION_PAGE_SIZE);

  // Already sorted newest-first by usePortfolio, so the first page is the
  // recent activity someone opening a holding is looking for.
  const visible = transactions.slice(0, visibleCount);
  const remaining = transactions.length - visible.length;

  const startEdit = (t: Transaction) => {
    setEditingId(t.id);
    setEditQty(t.quantity.toString());
    setEditPrice(t.price.toString());
  };

  const saveEdit = (id: string) => {
    const qty = parseFloat(editQty);
    const price = parseFloat(editPrice);
    if (!isNaN(qty) && qty > 0 && !isNaN(price) && price > 0) {
      onUpdate(id, { quantity: qty, price });
    }
    setEditingId(null);
  };

  return (
    <div className="p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Transaction History
        {transactions.length > TRANSACTION_PAGE_SIZE && (
          <span className="ml-1.5 font-normal">
            — showing {visible.length} of {transactions.length}
          </span>
        )}
      </p>
      <div className="space-y-1">
        {visible.map((t) => (
          <div key={t.id} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-muted/50">
            <span className="text-muted-foreground w-20">
              {new Date(t.date).toLocaleDateString('en-IN')}
            </span>
            <span className={`w-10 font-medium ${t.type === 'BUY' ? 'text-gain' : 'text-loss'}`}>
              {t.type}
            </span>
            {editingId === t.id ? (
              <>
                <input
                  type="number"
                  className="w-16 px-1 py-0.5 border border-input rounded text-right bg-background text-foreground text-xs"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                />
                <span className="text-muted-foreground">×</span>
                <input
                  type="number"
                  className="w-20 px-1 py-0.5 border border-input rounded text-right bg-background text-foreground text-xs"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                />
                <button onClick={() => saveEdit(t.id)} className="text-gain hover:opacity-70">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:opacity-70">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="text-foreground w-12 text-right">{t.quantity}</span>
                <span className="text-muted-foreground">×</span>
                <span className="text-foreground w-20 text-right">{mask(`₹${t.price.toFixed(2)}`)}</span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => startEdit(t)} className="text-muted-foreground hover:text-primary">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(t.id)} className="text-muted-foreground hover:text-loss">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {(remaining > 0 || visibleCount > TRANSACTION_PAGE_SIZE) && (
        <div className="mt-2 flex items-center gap-3">
          {remaining > 0 && (
            <button
              onClick={() => setVisibleCount((c) => c + TRANSACTION_PAGE_SIZE)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Show {Math.min(remaining, TRANSACTION_PAGE_SIZE)} more
            </button>
          )}
          {visibleCount > TRANSACTION_PAGE_SIZE && (
            <button
              onClick={() => setVisibleCount(TRANSACTION_PAGE_SIZE)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}
