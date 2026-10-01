import type { ReactNode } from 'react';
import { AuditTable } from '@/components/AuditPopover';
import type { NetWorthBridge } from '@/lib/netWorthMovement';

const MASK = '••••••';

/** ₹ amount, rounded to the rupee like the rest of Reports. */
export function fmtInr(n: number, hidden = false): string {
  if (hidden) return MASK;
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r !== 0 ? '-' : ''}₹${r.toLocaleString('en-IN')}`;
}

/** Signed ₹ amount with an explicit +/−; anything that rounds to ₹0 is shown without a sign. */
export function fmtSignedInr(n: number, hidden = false): string {
  if (hidden) return MASK;
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(Math.abs(n));
  if (r === 0) return '₹0';
  return `${n < 0 ? '−' : '+'}₹${r.toLocaleString('en-IN')}`;
}

export function fmtPts(n: number | null, hidden = false): string {
  if (hidden) return '••';
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
}

export function fmtShare(n: number | null, hidden = false): string {
  if (hidden) return '••';
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export function tone(n: number): string {
  if (Math.round(Math.abs(n)) === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-gain' : 'text-loss';
}

const Amt = ({ n, hidden }: { n: number; hidden: boolean }): ReactNode => (
  <span className={hidden ? '' : tone(n)}>{fmtSignedInr(n, hidden)}</span>
);

/**
 * Full attribution table for one NetWorthBridge: opening → each component → closing.
 * Rows sum exactly to the total change; "pts" are percentage points of the opening net worth and
 * sum to the total % change; "share" is each row ÷ the total change (rows can offset, so shares
 * may be negative or exceed 100%).
 */
export function NetWorthBridgeTable({
  bridge,
  hidden,
  openingLabel = 'Opening net worth',
  closingLabel = 'Closing net worth',
}: {
  bridge: NetWorthBridge;
  hidden: boolean;
  openingLabel?: string;
  closingLabel?: string;
}) {
  const holdings = bridge.rows.filter((r) => r.group === 'holdings');
  const balances = bridge.rows.filter((r) => r.group === 'balances');
  const showUnreconciled = Math.abs(bridge.unreconciled) >= 0.5;

  const subRow = (title: string, s: NetWorthBridge['holdingsSubtotal']) => [
    <span key="t" className="font-semibold">{title}</span>,
    <Amt key="a" n={s.amount} hidden={hidden} />,
    fmtPts(s.pts, hidden),
    fmtShare(s.share, hidden),
  ];
  const childRow = (r: NetWorthBridge['rows'][number]) => [
    <span key="t" className="pl-3 text-muted-foreground">↳ {r.label}</span>,
    <Amt key="a" n={r.amount} hidden={hidden} />,
    fmtPts(r.pts, hidden),
    fmtShare(r.share, hidden),
  ];

  const rows: ReactNode[][] = [
    [openingLabel, fmtInr(bridge.openingNetWorth, hidden), '', ''],
    subRow('Stock holdings', bridge.holdingsSubtotal),
    ...holdings.map(childRow),
    subRow('Balance updates (cash · PF · debt)', bridge.balancesSubtotal),
    ...balances.map(childRow),
  ];
  if (showUnreconciled) {
    rows.push([
      <span key="u" className="text-amber-600">Unreconciled (stored net worth ≠ its components)</span>,
      <Amt key="a" n={bridge.unreconciled} hidden={hidden} />,
      fmtPts(bridge.openingNetWorth > 0 ? (bridge.unreconciled / bridge.openingNetWorth) * 100 : null, hidden),
      fmtShare(Math.abs(bridge.change) > 0.01 ? (bridge.unreconciled / bridge.change) * 100 : null, hidden),
    ]);
  }

  return (
    <>
      <AuditTable
        headers={['Component', 'Change', 'Pts of opening', 'Share of Δ']}
        rows={rows}
        footer={[
          closingLabel,
          fmtInr(bridge.closingNetWorth, hidden),
          fmtPts(bridge.changePct, hidden),
          fmtShare(Math.abs(bridge.change) > 0.01 ? 100 : null, hidden),
        ]}
      />
      <p className="text-[10px] text-muted-foreground mt-1.5 font-mono leading-relaxed">
        Pts = Change ÷ {fmtInr(bridge.openingNetWorth, hidden)} × 100 · Share = Change ÷ {fmtSignedInr(bridge.change, hidden)} × 100
      </p>
    </>
  );
}

/**
 * Every input behind the bridge: each component's balance at both ends and the difference.
 * Liabilities are shown as negatives because they are subtracted from net worth.
 */
export function BalanceSheetTable({ bridge, hidden }: { bridge: NetWorthBridge; hidden: boolean }) {
  const { opening: o, closing: c } = bridge;
  const line = (label: string, a: number, b: number): ReactNode[] => [
    label, fmtInr(a, hidden), fmtInr(b, hidden), <Amt key="d" n={b - a} hidden={hidden} />,
  ];
  const rows: ReactNode[][] = [
    line('Stock holdings value', o.holdingsValue, c.holdingsValue),
    line('Operating Cash', o.liquidCash, c.liquidCash),
    line('Cash Reserve (Vault)', o.vaultCash, c.vaultCash),
    line('PF (PPF/EPF)', o.pfBalance, c.pfBalance),
    line('Liabilities (subtracted)', -o.creditCardDebt, -c.creditCardDebt),
  ];
  return (
    <AuditTable
      headers={['Balance', 'Opening', 'Closing', 'Δ']}
      rows={rows}
      footer={['Net worth', fmtInr(bridge.openingNetWorth, hidden), fmtInr(bridge.closingNetWorth, hidden), fmtSignedInr(bridge.change, hidden)]}
    />
  );
}
