import { useMemo } from 'react';
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import type { Transaction } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useChartRangeSelection } from '@/hooks/useChartRangeSelection';
import { computeRangeReturn, computeRangeXIRR } from '@/lib/chartRange';
import { ChartRangeBadge, ChartRangeReferenceArea } from '@/components/charts/ChartRangeBadge';
import { todayLocalDateString } from '@/lib/dateUtils';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

interface Props {
  transactions: Transaction[];
  currentPrices: Record<string, number>;
}

interface TimelinePoint {
  date: string;
  dateLabel: string;
  invested: number;
  currentValue: number;
  pnl: number;
}

export function PortfolioCharts({ transactions, currentPrices }: Props) {
  const { hidden, mask } = usePrivacy();
  const investedVsCurrent = useChartRangeSelection();
  const pnlOverTime = useChartRangeSelection();

  const timelineData = useMemo(() => {
    if (transactions.length === 0) return [];

    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const holdings: Record<
      string,
      { quantity: number; totalInvested: number; lastPrice: number }
    > = {};

    const points: TimelinePoint[] = [];
    const byDate: Record<string, Transaction[]> = {};
    for (const t of sorted) {
      const dateKey = t.date.split('T')[0];
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(t);
    }

    for (const [dateKey, txns] of Object.entries(byDate)) {
      for (const t of txns) {
        if (!holdings[t.symbol]) {
          holdings[t.symbol] = { quantity: 0, totalInvested: 0, lastPrice: t.price };
        }
        const h = holdings[t.symbol];
        if (t.type === 'BUY') {
          h.quantity += t.quantity;
          h.totalInvested += t.quantity * t.price;
        } else {
          h.quantity -= t.quantity;
          h.totalInvested -= t.quantity * t.price;
        }
        h.lastPrice = t.price;
      }

      let invested = 0;
      let currentValue = 0;
      for (const [symbol, h] of Object.entries(holdings)) {
        if (h.quantity > 0) {
          invested += h.totalInvested;
          const price = currentPrices[symbol] || h.lastPrice;
          currentValue += price * h.quantity;
        }
      }

      points.push({
        date: dateKey,
        dateLabel: formatDate(dateKey),
        invested,
        currentValue,
        pnl: currentValue - invested,
      });
    }

    // Local calendar date, not new Date().toISOString()'s UTC one — timeline points above are
    // keyed by t.date.split('T')[0] (the transaction's own, locally-meant calendar date), so
    // comparing against the UTC date would misjudge "is today already a point?" for the first
    // few hours after local midnight (see dateUtils.ts#todayLocalDateString).
    const today = todayLocalDateString();
    const lastPoint = points[points.length - 1];
    if (lastPoint && lastPoint.date !== today) {
      let invested = 0;
      let currentValue = 0;
      for (const [symbol, h] of Object.entries(holdings)) {
        if (h.quantity > 0) {
          invested += h.totalInvested;
          const price = currentPrices[symbol] || h.lastPrice;
          currentValue += price * h.quantity;
        }
      }
      points.push({
        date: today,
        dateLabel: formatDate(today),
        invested,
        currentValue,
        pnl: currentValue - invested,
      });
    }

    return points;
  }, [transactions, currentPrices]);

  if (timelineData.length < 2) {
    return null;
  }

  const investedVsCurrentRange =
    investedVsCurrent.selection.startIndex !== null && investedVsCurrent.selection.endIndex !== null
      ? computeRangeReturn(timelineData, investedVsCurrent.selection.startIndex, investedVsCurrent.selection.endIndex, 'currentValue', 'dateLabel')
      : null;
  // XIRR only makes sense for the Current Value series (a real position value backed by BUY/SELL
  // cash flows) — not for the P&L chart below, whose "value" is a derived difference, not
  // something you could annualize a return on.
  const investedVsCurrentXirr =
    investedVsCurrent.selection.startIndex !== null && investedVsCurrent.selection.endIndex !== null
      ? computeRangeXIRR(timelineData, investedVsCurrent.selection.startIndex, investedVsCurrent.selection.endIndex, 'currentValue', 'date', transactions)
      : undefined;
  const pnlRange =
    pnlOverTime.selection.startIndex !== null && pnlOverTime.selection.endIndex !== null
      ? computeRangeReturn(timelineData, pnlOverTime.selection.startIndex, pnlOverTime.selection.endIndex, 'pnl', 'dateLabel')
      : null;

  // Determine if latest P&L is negative for color
  const latestPnl = timelineData[timelineData.length - 1]?.pnl ?? 0;
  const pnlIsNegative = latestPnl < 0;
  const pnlColor = pnlIsNegative ? 'hsl(0, 72%, 51%)' : 'hsl(142, 71%, 45%)';

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs">
        <p className="font-medium text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {hidden ? '••••••' : fmt(p.value)}
          </p>
        ))}
      </div>
    );
  };

  const yAxisFormatter = (v: number) => hidden ? '•••' : `₹${(v / 1000).toFixed(0)}k`;

  return (
    <div className="space-y-6">
      {/* Invested vs Current Value */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Principal Capital Allocated vs Current Value
        </h2>
        <div className="relative rounded-lg border border-border bg-card p-4">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={timelineData} {...investedVsCurrent.handlers}>
              <defs>
                <linearGradient id="gradInvested" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(220, 70%, 55%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(220, 70%, 55%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCurrent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                tickFormatter={yAxisFormatter}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ChartRangeReferenceArea selection={investedVsCurrent.selection} data={timelineData} labelKey="dateLabel" />
              <Area
                type="monotone"
                dataKey="invested"
                name="Principal Capital Allocated"
                stroke="hsl(220, 70%, 55%)"
                fill="url(#gradInvested)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="currentValue"
                name="Current Value"
                stroke="hsl(142, 71%, 45%)"
                fill="url(#gradCurrent)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          <ChartRangeBadge
            selection={investedVsCurrent.selection}
            result={investedVsCurrentRange}
            onClear={investedVsCurrent.clear}
            unit="currency"
            valueLabel="Current Value"
            xirrPercent={investedVsCurrentXirr}
          />
        </div>
      </div>

      {/* P&L Over Time */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          P&L Over Time
        </h2>
        <div className="relative rounded-lg border border-border bg-card p-4">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={timelineData} {...pnlOverTime.handlers}>
              <defs>
                <linearGradient id="gradPnl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={pnlColor} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={pnlColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                tickFormatter={yAxisFormatter}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="hsl(0, 0%, 50%)" strokeDasharray="3 3" />
              <ChartRangeReferenceArea selection={pnlOverTime.selection} data={timelineData} labelKey="dateLabel" />
              <Area
                type="monotone"
                dataKey="pnl"
                name="P&L"
                stroke={pnlColor}
                fill="url(#gradPnl)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          <ChartRangeBadge
            selection={pnlOverTime.selection}
            result={pnlRange}
            onClear={pnlOverTime.clear}
            unit="currency"
            valueLabel="P&L"
          />
        </div>
      </div>
    </div>
  );
}
