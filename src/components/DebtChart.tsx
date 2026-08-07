import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ComposedChart,
  Area,
  Line,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePrivacy } from '@/contexts/PrivacyContext';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface Point {
  label: string;
  net_worth: number;
  debt: number;
  debt_pct: number;
}

export function DebtChart({ refreshKey }: { refreshKey: number }) {
  const { hidden } = usePrivacy();
  const [data, setData] = useState<Point[]>([]);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('net_worth_history')
        .select('*')
        .order('recorded_at', { ascending: true });
      if (!rows) return;
      setData(
        rows.map((r: any) => {
          const debt = Number(r.credit_card_debt ?? 0);
          const nw = Number(r.net_worth);
          // Use gross assets (nw + debt) as denominator so debt% is meaningful
          const gross = nw + debt;
          return {
            label: new Date(r.recorded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }),
            net_worth: nw,
            debt,
            debt_pct: gross > 0 ? (debt / gross) * 100 : 0,
          };
        })
      );
    })();
  }, [refreshKey]);

  if (data.length < 2) return null;
  const hasAnyDebt = data.some((d) => d.debt > 0);
  if (!hasAnyDebt) return null;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as Point;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs space-y-0.5">
        <p className="font-medium text-foreground mb-1">{label}</p>
        <p style={{ color: 'hsl(213, 75%, 55%)' }}>AUM: {hidden ? '••••••' : fmt(p.net_worth)}</p>
        <p style={{ color: 'hsl(var(--loss))' }}>Debt: {hidden ? '••••••' : fmt(p.debt)}</p>
        <p className="text-muted-foreground">Debt %: {p.debt_pct.toFixed(2)}%</p>
      </div>
    );
  };

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">Debt % vs AUM Over Time</h2>
      <div className="rounded-lg border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="gradNW" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(213, 75%, 55%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(213, 75%, 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              yAxisId="left"
              tickFormatter={(v) => (hidden ? '•••' : `₹${(v / 100000).toFixed(1)}L`)}
              tick={{ fontSize: 11 }}
              width={60}
              className="fill-muted-foreground"
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => `${v.toFixed(1)}%`}
              tick={{ fontSize: 11 }}
              width={50}
              className="fill-muted-foreground"
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="net_worth"
              stroke="hsl(213, 75%, 55%)"
              fill="url(#gradNW)"
              strokeWidth={2}
              name="AUM"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="debt_pct"
              stroke="hsl(var(--loss))"
              strokeWidth={2}
              dot={false}
              name="Debt %"
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-2">
          Debt % = Outstanding Liabilities / (AUM + Liability). Lower is better.
        </p>
      </div>
    </div>
  );
}
