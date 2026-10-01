import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useNetWorthHistory } from '@/hooks/useNetWorthHistory';
import { EmptyState } from '@/components/EmptyState';
import { AuditPopover, AuditSection, AuditTable, Formula, SourceBadge } from '@/components/AuditPopover';
import { BalanceSheetTable, NetWorthBridgeTable, fmtInr, fmtSignedInr, tone } from '@/components/NetWorthBridgeTable';
import { buildMonthlyMovements, unpricedTradedSymbols, type MonthMovement } from '@/lib/netWorthMovement';
import type { CurrentPrices, Transaction } from '@/types/portfolio';

import { Card } from '@/components/ui/card';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

function colorFor(pct: number): string {
  if (!Number.isFinite(pct)) return 'hsl(var(--muted) / 0.3)';
  const t = Math.max(-10, Math.min(10, pct)) / 10;
  if (t >= 0) return `hsl(var(--gain) / ${0.15 + t * 0.7})`;
  return `hsl(var(--loss) / ${0.15 + -t * 0.7})`;
}

function fmtWhen(d: Date): string {
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function MonthAudit({ m, hidden, currentPrices }: { m: MonthMovement; hidden: boolean; currentPrices?: CurrentPrices }) {
  const monthLabel = MONTHS[m.monthIdx];
  const prevLabel = MONTHS[(m.monthIdx + 11) % 12];
  const { bridge } = m;
  const trades = bridge.flow.trades;
  const unpriced = currentPrices ? unpricedTradedSymbols(trades, currentPrices) : [];

  return (
    <>
      <AuditSection label="Formula">
        <Formula>
          Month-over-month % = (Closing − Opening) ÷ Opening<br />
          = ({fmtInr(m.closing.netWorth, hidden)} − {fmtInr(m.opening.netWorth, hidden)}) ÷ {fmtInr(m.opening.netWorth, hidden)}<br />
          = {hidden ? '••' : `${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(2)}%`}
        </Formula>
      </AuditSection>

      <AuditSection label="Where the two values come from">
        <div className="space-y-1">
          <p><SourceBadge source="snapshot" /> Opening = last snapshot of <b>{prevLabel}</b>, taken {fmtWhen(m.opening.at)}</p>
          <p><SourceBadge source="snapshot" /> Closing = last snapshot of <b>{monthLabel}</b>, taken {fmtWhen(m.closing.at)}</p>
        </div>
      </AuditSection>

      <AuditSection label="Every balance at both ends">
        <BalanceSheetTable bridge={bridge} hidden={hidden} />
      </AuditSection>

      <AuditSection label="What moved">
        <NetWorthBridgeTable
          bridge={bridge}
          hidden={hidden}
          openingLabel={`Opening (${prevLabel} snapshot)`}
          closingLabel={`Closing (${monthLabel} snapshot)`}
        />
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Pts = percentage points of opening net worth; they add up to the cell's %. Stock-holdings value comes from the
          snapshot's own portfolio value; "new money" is the buys − sells dated inside the window and "price movement" is the rest.
        </p>
      </AuditSection>

      <AuditSection label={`Event ledger · ${m.ledger.length} snapshot${m.ledger.length === 1 ? '' : 's'} in ${monthLabel}`}>
        <AuditTable
          headers={['When', 'What changed', 'Holdings Δ', 'Net worth Δ']}
          rows={m.ledger.map((e) => [
            fmtWhen(e.at),
            <div key="c" className="text-left space-y-0.5">
              {e.balanceChanges.length === 0 && <div className="text-muted-foreground">No balance edit</div>}
              {e.balanceChanges.map((c) => (
                <div key={c.label}>{c.label}: {fmtInr(c.from, hidden)} → {fmtInr(c.to, hidden)}</div>
              ))}
            </div>,
            <div key="h" className="space-y-0.5">
              <div className={hidden ? '' : tone(e.holdingsDelta)}>{fmtSignedInr(e.holdingsDelta, hidden)}</div>
              {Math.round(Math.abs(e.holdingsDelta)) > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  new money {fmtSignedInr(e.newMoney, hidden)} · price {fmtSignedInr(e.priceMovement, hidden)}
                </div>
              )}
            </div>,
            <span key="n" className={hidden ? '' : tone(e.netWorthDelta)}>{fmtSignedInr(e.netWorthDelta, hidden)}</span>,
          ])}
          footer={['Total', '', fmtSignedInr(bridge.holdingsSubtotal.amount, hidden), fmtSignedInr(bridge.explained, hidden)]}
        />
      </AuditSection>

      {trades.length > 0 && (
        <AuditSection label={`Trades dated in this window · net ${fmtSignedInr(bridge.flow.net, hidden)}`}>
          <AuditTable
            headers={['Date', 'Trade', 'Qty × Price', 'Value']}
            rows={trades.map((t) => [
              fmtDay(t.date),
              `${t.type} ${t.symbol}`,
              hidden ? '••' : `${t.quantity} × ${t.price}`,
              fmtInr(t.type === 'BUY' ? t.value : -t.value, hidden),
            ])}
          />
        </AuditSection>
      )}

      {unpriced.length > 0 && (
        <p className="text-[10px] text-amber-600">
          {unpriced.join(', ')} {unpriced.length === 1 ? 'has' : 'have'} no stored price, and snapshots value a symbol with no price at ₹0.
          Its buys therefore appear as "new money" with an equal offsetting loss inside "price movement" — the net worth total is unaffected,
          but treat the new-money / price-movement split as unreliable for this month.
        </p>
      )}

      {Math.abs(bridge.unreconciled) >= 0.5 && (
        <p className="text-[10px] text-amber-600">
          The stored net worth for one of these snapshots differs from the sum of its own components by {fmtSignedInr(bridge.unreconciled, hidden)};
          it is shown as "Unreconciled" rather than hidden inside another row.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Snapshots are written when a balance or trade is saved, valuing holdings at the live price at that moment. The window runs from the
        previous month's last snapshot to this month's last one. A trade entered with a back-dated trade date can land in the "price movement" row
        instead of "new money"; the holdings total is unaffected.
      </p>
    </>
  );
}

const NO_TRANSACTIONS: Transaction[] = [];

export function SeasonalityHeatmap({
  transactions = NO_TRANSACTIONS,
  currentPrices,
}: { transactions?: Transaction[]; currentPrices?: CurrentPrices }) {
  const { hidden } = usePrivacy();
  const { data: rows, loading } = useNetWorthHistory();

  const { fys, grid } = useMemo(() => buildMonthlyMovements(rows, transactions), [rows, transactions]);

  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Seasonality · Monthly Net-Worth Returns</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Month-over-month % change in net worth. Indian FY (Apr → Mar). Cells empty when no snapshot exists.
        Click a cell to audit what moved — balance updates vs stock holdings.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading snapshots…</p>
      ) : fys.length === 0 ? (
        <EmptyState compact text="No net-worth history yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] font-mono border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="p-1 text-muted-foreground font-medium">FY</th>
                {MONTHS.map(m => (
                  <th key={m} className="p-1 text-muted-foreground font-medium w-12">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fys.map((fy, i) => (
                <tr key={fy}>
                  <td className="pr-2 text-muted-foreground font-medium whitespace-nowrap">FY{String(fy).slice(-2)}-{String(fy + 1).slice(-2)}</td>
                  {grid[i].map((cell, j) => {
                    const v = cell?.pct ?? null;
                    const text = hidden ? '••' : v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
                    return (
                      <td
                        key={j}
                        title={v == null ? 'No data' : `${MONTHS[j]}: ${v.toFixed(2)}% — click to audit`}
                        className="w-12 h-10 text-center border border-border/50 rounded-sm"
                        style={{ backgroundColor: colorFor(v ?? NaN), color: v != null && Math.abs(v) > 5 ? '#fff' : 'hsl(var(--foreground))' }}
                      >
                        {cell ? (
                          <AuditPopover
                            title={`${MONTHS[j]} FY${String(fy).slice(-2)}-${String(fy + 1).slice(-2)} movement`}
                            align="center"
                            className="h-10 flex items-center justify-center"
                            trigger={<span>{text}</span>}
                          >
                            <MonthAudit m={cell} hidden={hidden} currentPrices={currentPrices} />
                          </AuditPopover>
                        ) : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
