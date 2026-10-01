import type { ReactNode } from 'react';
import { AlertTriangle, GitCompareArrows } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AuditPopover, AuditSection, AuditTable, Formula, SourceBadge } from '@/components/AuditPopover';
import { BalanceSheetTable, NetWorthBridgeTable, fmtInr, fmtPts, fmtShare, fmtSignedInr, tone } from '@/components/NetWorthBridgeTable';
import type { PeriodBridge } from '@/lib/netWorthMovement';

export interface PeriodMovementColumn {
  key: string;
  /** Short column header, e.g. "Q2 2026-27". */
  label: string;
  /** Long form for the audit popover title, e.g. "Q2 · Jul–Sep 2026". */
  title: string;
  status: 'completed' | 'in-progress' | 'upcoming';
  bridge: PeriodBridge | null;
}

interface Props {
  periodLabel: string;
  periodTypeLabel: string;
  status: 'completed' | 'in-progress' | 'upcoming';
  bridge: PeriodBridge | null;
  columns: PeriodMovementColumn[];
  activeKey: string;
  /** recorded_at of the net_worth_history row that supplied opening / closing cash balances (null = none). */
  openingCashSnapshotAt: Date | null;
  closingCashSnapshotAt: Date | null;
  hidden: boolean;
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtWhen = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const Signed = ({ n, hidden }: { n: number; hidden: boolean }) => (
  <span className={hidden ? '' : tone(n)}>{fmtSignedInr(n, hidden)}</span>
);

function Tile({ label, amount, pts, share, hidden, audit, title }: {
  label: string; amount: number; pts: number | null; share: number | null; hidden: boolean; audit: ReactNode; title: string;
}) {
  return (
    <AuditPopover
      title={title}
      trigger={
        <div className="rounded-xl border border-border p-4 bg-secondary/30 hover:border-foreground/40 transition-colors w-full">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label} · click to audit</p>
          <p className={`text-xl font-bold mt-1 ${hidden ? 'text-foreground' : tone(amount)}`}>{fmtSignedInr(amount, hidden)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {fmtPts(pts, hidden)} pts of opening · {fmtShare(share, hidden)} of the change
          </p>
        </div>
      }
    >
      {audit}
    </AuditPopover>
  );
}

function BalancesAudit({ b, openAt, closeAt, hidden }: { b: PeriodBridge; openAt: Date | null; closeAt: Date | null; hidden: boolean }) {
  const accounts = b.rows.filter((r) => r.group === 'balances');
  return (
    <>
      <AuditSection label="Formula">
        <Formula>
          Balance contribution = Σ (closing − opening) of Operating Cash, Vault, PF<br />
          − (closing − opening) of Liabilities<br />
          = {fmtSignedInr(b.balancesSubtotal.amount, hidden)}
        </Formula>
      </AuditSection>
      <AuditSection label="Account by account">
        <AuditTable
          headers={['Account', 'Opening', 'Closing', 'Effect on NW']}
          rows={accounts.map((r) => [
            r.label,
            fmtInr(r.opening ?? 0, hidden),
            fmtInr(r.closing ?? 0, hidden),
            <Signed key="e" n={r.amount} hidden={hidden} />,
          ])}
          footer={['Total', '', '', fmtSignedInr(b.balancesSubtotal.amount, hidden)]}
        />
      </AuditSection>
      <AuditSection label="Where the balances come from">
        <div className="space-y-1">
          <p><SourceBadge source={openAt ? 'snapshot' : 'none'} /> Opening: {openAt ? `net-worth snapshot of ${fmtWhen(openAt)} (latest at or before the end of ${fmtDate(b.openingAsOf)})` : 'no snapshot at or before the opening date → ₹0'}</p>
          <p><SourceBadge source={closeAt ? 'snapshot' : 'none'} /> Closing: {closeAt ? `net-worth snapshot of ${fmtWhen(closeAt)} (latest at or before the end of ${fmtDate(b.closingAsOf)})` : 'no snapshot at or before the closing date → ₹0'}</p>
        </div>
      </AuditSection>
    </>
  );
}

function NewMoneyAudit({ b, hidden }: { b: PeriodBridge; hidden: boolean }) {
  const { flow } = b;
  return (
    <>
      <AuditSection label="Formula">
        <Formula>
          New money = Σ BUY (qty × price) − Σ SELL (qty × price)<br />
          = {fmtInr(flow.buyValue, hidden)} − {fmtInr(flow.sellValue, hidden)} = {fmtSignedInr(flow.net, hidden)}
        </Formula>
      </AuditSection>
      <AuditSection label={`Trades in window · ${flow.buyCount} buy / ${flow.sellCount} sell`}>
        {flow.trades.length === 0 ? (
          <p className="text-muted-foreground">No trades dated inside this window.</p>
        ) : (
          <AuditTable
            headers={['Date', 'Trade', 'Qty × Price', 'Value']}
            rows={flow.trades.map((t) => [
              fmtDate(t.date),
              `${t.type} ${t.symbol}`,
              hidden ? '••' : `${t.quantity} × ${t.price}`,
              fmtInr(t.type === 'BUY' ? t.value : -t.value, hidden),
            ])}
            footer={['Net', '', '', fmtSignedInr(flow.net, hidden)]}
          />
        )}
      </AuditSection>
      <p className="text-[10px] text-muted-foreground">
        Window = trades dated after the opening point and up to the closing point — the same trades that entered the holdings value between the two snapshots.
      </p>
    </>
  );
}

function PriceMovementAudit({ b, hidden }: { b: PeriodBridge; hidden: boolean }) {
  const holdingsDelta = b.holdingsSubtotal.amount;
  return (
    <>
      <AuditSection label="Formula">
        <Formula>
          Price movement = Δ holdings value − new money<br />
          = {fmtSignedInr(holdingsDelta, hidden)} − {fmtSignedInr(b.flow.net, hidden)} = {fmtSignedInr(b.rows.find((r) => r.key === 'priceMovement')!.amount, hidden)}
        </Formula>
      </AuditSection>
      <AuditSection label="Per holding">
        {b.holdingMovements.length === 0 ? (
          <p className="text-muted-foreground">No holding changed in value during this window.</p>
        ) : (
          <AuditTable
            headers={['Symbol', 'Opening', 'New money', 'Price move', 'Closing']}
            rows={b.holdingMovements.map((m) => [
              m.symbol,
              <div key="o" className="space-y-0.5">
                <div>{fmtInr(m.openingValue, hidden)}</div>
                <div className="text-[10px] text-muted-foreground">{hidden ? '••' : `${+m.openingQty.toFixed(4)} × ${fmtInr(m.openingPrice)}`}</div>
              </div>,
              fmtSignedInr(m.newMoney, hidden),
              <Signed key="p" n={m.priceMovement} hidden={hidden} />,
              <div key="c" className="space-y-0.5">
                <div>{fmtInr(m.closingValue, hidden)}</div>
                <div className="text-[10px] text-muted-foreground">{hidden ? '••' : `${+m.closingQty.toFixed(4)} × ${fmtInr(m.closingPrice)}`}</div>
              </div>,
            ])}
            footer={[
              'Total',
              fmtInr(b.holdingMovements.reduce((s, m) => s + m.openingValue, 0), hidden),
              fmtSignedInr(b.holdingMovements.reduce((s, m) => s + m.newMoney, 0), hidden),
              fmtSignedInr(b.holdingMovements.reduce((s, m) => s + m.priceMovement, 0), hidden),
              fmtInr(b.holdingMovements.reduce((s, m) => s + m.closingValue, 0), hidden),
            ]}
          />
        )}
      </AuditSection>
      <p className="text-[10px] text-muted-foreground">
        Per holding: price move = closing value − opening value − new money (value = quantity × price). Holdings are valued with the Reports page's price rule (historical close at or before each date; live price only for an in-progress closing point).
        A holding marked at cost shows ₹0 price movement.
      </p>
    </>
  );
}

export function PeriodMovementCard({
  periodLabel, periodTypeLabel, status, bridge, columns, activeKey,
  openingCashSnapshotAt, closingCashSnapshotAt, hidden,
}: Props) {
  if (status === 'upcoming') {
    return (
      <Card className="rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <GitCompareArrows className="w-4 h-4 text-foreground" />
          <h3 className="text-sm font-semibold text-foreground">What Moved Your Net Worth · {periodLabel}</h3>
        </div>
        <p className="text-xs text-muted-foreground">This period hasn't started yet — there is nothing to attribute.</p>
      </Card>
    );
  }

  const priceRow = bridge?.rows.find((r) => r.key === 'priceMovement');
  const newMoneyRow = bridge?.rows.find((r) => r.key === 'newMoney');
  const comparable = bridge !== null && bridge.openingNetWorth > 0;

  return (
    <Card className="rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-foreground" />
            <h3 className="text-sm font-semibold text-foreground">What Moved Your Net Worth · {periodLabel}</h3>
          </div>
          {bridge && (
            <p className="text-[11px] text-muted-foreground mt-1">
              close of {fmtDate(bridge.openingAsOf)} → {status === 'in-progress' ? 'today (live)' : `close of ${fmtDate(bridge.closingAsOf)}`} · vs previous {periodTypeLabel}
            </p>
          )}
        </div>
        {bridge && (
          <AuditPopover
            title={`Net-worth change · ${periodLabel}`}
            align="end"
            className="w-auto"
            trigger={
              <div className="text-right cursor-help">
                <p className={`text-lg font-bold ${hidden ? 'text-foreground' : tone(bridge.change)}`}>{fmtSignedInr(bridge.change, hidden)}</p>
                <p className="text-[11px] text-muted-foreground">{fmtPts(bridge.changePct, hidden)}% · click to audit</p>
              </div>
            }
          >
            <AuditSection label="Formula">
              <Formula>
                Change = Closing − Opening<br />
                = {fmtInr(bridge.closingNetWorth, hidden)} − {fmtInr(bridge.openingNetWorth, hidden)} = {fmtSignedInr(bridge.change, hidden)}<br />
                % = Change ÷ Opening = {fmtPts(bridge.changePct, hidden)}%
              </Formula>
            </AuditSection>
            <AuditSection label="Every balance at both ends">
              <BalanceSheetTable bridge={bridge} hidden={hidden} />
            </AuditSection>
            <AuditSection label="What moved">
              <NetWorthBridgeTable bridge={bridge} hidden={hidden} />
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Opening and closing are the same AUM figures shown on this page. Pts add up to the total %. Share = row ÷ total change (rows can offset each other).
              </p>
            </AuditSection>
          </AuditPopover>
        )}
      </div>

      {!bridge || !comparable ? (
        <p className="text-xs text-muted-foreground">
          No opening net worth to compare against for this period (nothing was held or recorded at its start).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tile
              label="Balance updates" title="Balance updates (cash · PF · debt)"
              amount={bridge.balancesSubtotal.amount} pts={bridge.balancesSubtotal.pts} share={bridge.balancesSubtotal.share} hidden={hidden}
              audit={<BalancesAudit b={bridge} openAt={openingCashSnapshotAt} closeAt={closingCashSnapshotAt} hidden={hidden} />}
            />
            <Tile
              label="Investment (new money)" title="Investment · new money"
              amount={newMoneyRow!.amount} pts={newMoneyRow!.pts} share={newMoneyRow!.share} hidden={hidden}
              audit={<NewMoneyAudit b={bridge} hidden={hidden} />}
            />
            <Tile
              label="Holdings price movement" title="Stock holdings · price movement"
              amount={priceRow!.amount} pts={priceRow!.pts} share={priceRow!.share} hidden={hidden}
              audit={<PriceMovementAudit b={bridge} hidden={hidden} />}
            />
          </div>

          <NetWorthBridgeTable bridge={bridge} hidden={hidden} />

          {bridge.caveats.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-1">
                {bridge.caveats.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {columns.length > 1 || columns.some((c) => c.bridge) ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Comparison across {periodTypeLabel}s of this fiscal year · each cell: ₹ change, pts of that period's opening net worth
          </p>
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-secondary/60">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Component</th>
                  {columns.map((c) => (
                    <th key={c.key} className={`px-2 py-1.5 text-right font-medium ${c.key === activeKey ? 'text-foreground bg-secondary' : 'text-muted-foreground'}`}>
                      {c.bridge && c.bridge.openingNetWorth > 0 && c.status !== 'upcoming' ? (
                        <AuditPopover
                          title={`Movement · ${c.title}`}
                          align="end"
                          className="w-auto ml-auto"
                          trigger={
                            <span className="underline decoration-dotted underline-offset-2 cursor-help">
                              {c.label}
                              {c.status === 'in-progress' && <span className="ml-1 text-[9px]">●</span>}
                            </span>
                          }
                        >
                          <AuditSection label="Formula">
                            <Formula>
                              Change = Closing − Opening<br />
                              = {fmtInr(c.bridge.closingNetWorth, hidden)} − {fmtInr(c.bridge.openingNetWorth, hidden)} = {fmtSignedInr(c.bridge.change, hidden)} ({fmtPts(c.bridge.changePct, hidden)}%)
                            </Formula>
                          </AuditSection>
                          <AuditSection label="Every balance at both ends">
                            <BalanceSheetTable bridge={c.bridge} hidden={hidden} />
                          </AuditSection>
                          <AuditSection label="What moved">
                            <NetWorthBridgeTable bridge={c.bridge} hidden={hidden} />
                          </AuditSection>
                          {c.bridge.caveats.length > 0 && (
                            <ul className="text-[10px] text-amber-600 space-y-1">
                              {c.bridge.caveats.map((cv, i) => <li key={i}>{cv}</li>)}
                            </ul>
                          )}
                        </AuditPopover>
                      ) : (
                        <>
                          {c.label}
                          {c.status === 'in-progress' && <span className="ml-1 text-[9px]">●</span>}
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <ComparisonRow label="Opening net worth" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => ({ main: fmtInr(b.openingNetWorth, hidden) })} />
                <ComparisonRow label="New money invested" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'newMoney', hidden)} />
                <ComparisonRow label="Price movement" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'priceMovement', hidden)} />
                <ComparisonRow label="Operating Cash" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'operatingCash', hidden)} />
                <ComparisonRow label="Vault" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'vaultCash', hidden)} />
                <ComparisonRow label="PF" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'pfBalance', hidden)} />
                <ComparisonRow label="Liabilities" columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => rowCell(b, 'liabilities', hidden)} />
                <ComparisonRow
                  label="Total change" strong columns={columns} activeKey={activeKey} hidden={hidden}
                  value={(b) => ({ main: fmtSignedInr(b.change, hidden), sub: `${fmtPts(b.changePct, hidden)}%`, n: b.change })}
                />
                <ComparisonRow label="Closing net worth" strong columns={columns} activeKey={activeKey} hidden={hidden} value={(b) => ({ main: fmtInr(b.closingNetWorth, hidden) })} />
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

type Cell = { main: string; sub?: string; n?: number };

function rowCell(b: PeriodBridge, key: PeriodBridge['rows'][number]['key'], hidden: boolean): Cell {
  const r = b.rows.find((x) => x.key === key)!;
  return { main: fmtSignedInr(r.amount, hidden), sub: `${fmtPts(r.pts, hidden)} pts`, n: r.amount };
}

function ComparisonRow({
  label, columns, activeKey, hidden, value, strong,
}: {
  label: string; columns: PeriodMovementColumn[]; activeKey: string; hidden: boolean; strong?: boolean;
  value: (b: PeriodBridge) => Cell;
}) {
  return (
    <tr className={`border-t border-border/60 ${strong ? 'bg-secondary/40 font-semibold' : ''}`}>
      <td className="px-2 py-1 text-left text-foreground whitespace-nowrap">{label}</td>
      {columns.map((c) => {
        const usable = c.bridge !== null && c.bridge.openingNetWorth > 0 && c.status !== 'upcoming';
        const cell = usable ? value(c.bridge!) : null;
        return (
          <td key={c.key} className={`px-2 py-1 text-right whitespace-nowrap ${c.key === activeKey ? 'bg-secondary/50' : ''}`}>
            {cell ? (
              <>
                <span className={!hidden && cell.n !== undefined ? tone(cell.n) : ''}>{cell.main}</span>
                {cell.sub && <span className="block text-[10px] text-muted-foreground font-normal">{cell.sub}</span>}
              </>
            ) : '—'}
          </td>
        );
      })}
    </tr>
  );
}
