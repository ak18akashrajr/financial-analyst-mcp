import type { Transaction } from '@/types/portfolio';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

interface Props {
  transactions: Transaction[];
}

export function RecentActivity({ transactions }: Props) {
  const { mask } = usePrivacy();
  const fmt = (n: number) => mask(fmtRaw(n));

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const recent = transactions
    .filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (recent.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">Capital Deployment Log (This Month)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {recent.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2">
              <div className={`p-1 rounded ${t.type === 'BUY' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                {t.type === 'BUY' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              </div>
              <div>
                <p className="font-medium text-sm text-foreground">{t.symbol}</p>
                <p className="text-xs text-muted-foreground">{t.type} · {formatDate(t.date)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground">{fmt(t.quantity * t.price)}</p>
              <p className="text-xs text-muted-foreground">{t.quantity} × {fmt(t.price)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
