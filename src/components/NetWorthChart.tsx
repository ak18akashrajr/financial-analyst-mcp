import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn, computeRangeXIRR } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';
import type { Transaction } from '@/types/portfolio';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// AUM target — feature-ideas/TODO backlog item: ₹50L by March 2028.
const AUM_GOAL = 5_000_000;
const AUM_GOAL_LABEL = 'Mar 2028';

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
  /**
   * Transaction history, used only to compute the annualized (XIRR) return shown on the
   * drag-select badge (feature-ideas.md #6). Optional — when omitted, the badge falls back to
   * the plain point-to-point % change with no XIRR row.
   */
  transactions?: Transaction[];
}

export function NetWorthChart({ currentNetWorth, portfolioValue, liquidCash, vaultCash, refreshKey, transactions }: Props) {
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

  const percentOfGoal = (currentNetWorth / AUM_GOAL) * 100;

  const rangeResult =
    selection.startIndex !== null && selection.endIndex !== null
      ? computeRangeReturn(data, selection.startIndex, selection.endIndex, 'net_worth', 'label')
      : null;
  const rangeXirr =
    transactions && selection.startIndex !== null && selection.endIndex !== null
      ? computeRangeXIRR(data, selection.startIndex, selection.endIndex, 'net_worth', 'recorded_at', transactions)
      : undefined;

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
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium text-muted-foreground">AUM Over Time</h2>
        <span className="text-xs text-muted-foreground">
          {hidden ? '•••' : `${percentOfGoal.toFixed(1)}%`} of ₹50L goal ({AUM_GOAL_LABEL})
        </span>
      </div>
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
            <YAxis
              tickFormatter={yAxisFormatter}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              width={60}
              domain={[0, (max: number) => Math.max(max, AUM_GOAL) * 1.05]}
            />
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
            <ReferenceLine
              y={AUM_GOAL}
              stroke="hsl(38, 92%, 50%)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: hidden ? `Goal (${AUM_GOAL_LABEL})` : `Goal: ₹50L (${AUM_GOAL_LABEL})`,
                position: 'insideTopRight',
                fill: 'hsl(38, 92%, 50%)',
                fontSize: 11,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
        <ChartRangeBadge selection={selection} result={rangeResult} onClear={clear} unit="currency" valueLabel="AUM" xirrPercent={rangeXirr} />
      </div>
    </div>
  );
}
