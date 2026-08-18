import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface NetWorthPoint {
  recorded_at: string;
  label: string;
  net_worth: number;
}

interface Props {
  currentNetWorth: number;
  portfolioValue: number;
  liquidCash: number;
  vaultCash: number;
  refreshKey: number; // bumped on transaction/cash changes
}

export function NetWorthChart({ currentNetWorth, portfolioValue, liquidCash, vaultCash, refreshKey }: Props) {
  const { hidden } = usePrivacy();
  const [data, setData] = useState<NetWorthPoint[]>([]);
  const { selection, handlers, clear } = useChartRangeSelection();

  // Load history on mount and when refreshKey changes
  useEffect(() => {
    loadHistory();
  }, [refreshKey]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const { data: rows } = await supabase
      .from('net_worth_history')
      .select('*')
      .order('recorded_at', { ascending: true });

    if (rows) {
      setData(
        rows.map((r: any) => ({
          recorded_at: r.recorded_at,
          label: new Date(r.recorded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }),
          net_worth: Number(r.net_worth),
        }))
      );
    }
  }

  if (data.length < 2) return null;

  const rangeResult =
    selection.startIndex !== null && selection.endIndex !== null
      ? computeRangeReturn(data, selection.startIndex, selection.endIndex, 'net_worth', 'label')
      : null;

  const yAxisFormatter = (v: number) => hidden ? '•••' : `₹${(v / 100000).toFixed(1)}L`;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs">
        <p className="font-medium text-foreground mb-1">{label}</p>
        <p style={{ color: 'hsl(213, 75%, 55%)' }}>
          AUM: {hidden ? '••••••' : fmt(payload[0].value)}
        </p>
      </div>
    );
  };

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">AUM Over Time</h2>
      <div className="relative rounded-lg border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} {...handlers}>
            <defs>
              <linearGradient id="gradNetWorth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(213, 75%, 55%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(213, 75%, 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tickFormatter={yAxisFormatter} tick={{ fontSize: 11 }} className="fill-muted-foreground" width={60} />
            <Tooltip content={<CustomTooltip />} />
            <ChartRangeReferenceArea selection={selection} data={data} labelKey="label" />
            <Area
              type="monotone"
              dataKey="net_worth"
              name="AUM"
              stroke="hsl(213, 75%, 55%)"
              fill="url(#gradNetWorth)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
        <ChartRangeBadge selection={selection} result={rangeResult} onClear={clear} unit="currency" valueLabel="AUM" />
      </div>
    </div>
  );
}
