import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { computePerformanceAttribution, type PerformanceContribution } from '@/lib/performanceAttribution';
import type { DerivedHolding } from '@/types/portfolio';

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

interface TooltipPayload {
  active?: boolean;
  payload?: { payload: PerformanceContribution }[];
}

function AttributionTooltip({ active, payload, mask }: TooltipPayload & { mask: (v: string) => string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground mb-1">{row.symbol}</p>
      <p className="text-muted-foreground">
        Contributed <span className={row.contributionPercent >= 0 ? 'text-gain' : 'text-loss'}>{fmtPct(row.contributionPercent)}</span> of total return
      </p>
      <p className="text-muted-foreground">
        P&L: {mask(fmtCurrency(row.pnl))} ({fmtPct(row.pnlPercent)} on its own cost basis)
      </p>
    </div>
  );
}

interface Props {
  holdings: DerivedHolding[];
}

export function PerformanceAttribution({ holdings }: Props) {
  const { mask } = usePrivacy();
  const contributions = computePerformanceAttribution(holdings);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">Performance Attribution</h3>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        Which holdings drove your overall return, not just which did best on their own
      </p>
      {contributions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Add a holding with invested capital to see what's driving your returns.
        </p>
      ) : (
        <div className="h-full" style={{ height: Math.max(180, contributions.length * 36) }}>
          <ResponsiveContainer>
            <BarChart data={contributions} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
              />
              <YAxis
                type="category"
                dataKey="symbol"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                width={72}
              />
              <Tooltip
                content={(props) => <AttributionTooltip {...(props as TooltipPayload)} mask={mask} />}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Bar dataKey="contributionPercent" name="Contribution to return" radius={[0, 4, 4, 0]}>
                {contributions.map((c) => (
                  <Cell key={c.symbol} fill={c.contributionPercent >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {contributions.length > 0 && (
        <div data-testid="attribution-legend" className="mt-4 space-y-1.5 border-t border-border pt-3">
          {contributions.map((c) => (
            <div key={c.symbol} className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{c.symbol}</span>
              <span className={c.contributionPercent >= 0 ? 'text-gain' : 'text-loss'}>
                {fmtPct(c.contributionPercent)} <span className="text-muted-foreground">({mask(fmtCurrency(c.pnl))})</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
