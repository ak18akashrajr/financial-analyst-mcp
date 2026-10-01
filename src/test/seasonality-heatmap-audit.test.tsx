// Seasonality heatmap cells are click-to-audit: the popover must show WHAT moved net worth that
// month (balance edit vs stock holdings), with the exact before → after balances.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeasonalityHeatmap } from '@/components/SeasonalityHeatmap';
import { useNetWorthHistory } from '@/hooks/useNetWorthHistory';
import { usePrivacy } from '@/contexts/PrivacyContext';

vi.mock('@/hooks/useNetWorthHistory', () => ({ useNetWorthHistory: vi.fn() }));
vi.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: vi.fn() }));

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const row = (recorded_at: string, p: { portfolio: number; liquid: number; vault: number; pf: number; debt: number }) => ({
  recorded_at,
  portfolio_value: p.portfolio,
  liquid_cash: p.liquid,
  vault_cash: p.vault,
  pf_balance: p.pf,
  credit_card_debt: p.debt,
  net_worth: p.portfolio + p.liquid + p.vault + p.pf - p.debt,
});

const HISTORY = [
  row(at(2026, 9, 30, 18), { portfolio: 500_000, liquid: 20_000, vault: 90_000, pf: 100_000, debt: 10_000 }),
  row(at(2026, 10, 1, 10), { portfolio: 500_000, liquid: 20_000, vault: 150_000, pf: 100_000, debt: 10_000 }),
];

describe('SeasonalityHeatmap click-to-audit', () => {
  beforeEach(() => {
    vi.mocked(useNetWorthHistory).mockReturnValue({ data: HISTORY, loading: false });
    vi.mocked(usePrivacy).mockReturnValue({ hidden: false, toggle: vi.fn() } as unknown as ReturnType<typeof usePrivacy>);
  });

  it('shows the vault balance update as the source of the October move', async () => {
    render(<SeasonalityHeatmap transactions={[]} />);

    // 60,000 / 700,000 = 8.5714…% → cell label "+8.6"
    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Oct FY26-27 movement/i }));

    expect(await screen.findByText('Cash Reserve (Vault): ₹90,000 → ₹1,50,000')).toBeInTheDocument();
    expect(screen.getByText(/= \+8\.57%/)).toBeInTheDocument();
    // Opening → closing net worth are the real stored values.
    expect(screen.getAllByText('₹7,00,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹7,60,000').length).toBeGreaterThan(0);
    // Holdings did not move; the whole +60,000 is on the balance side.
    expect(screen.getAllByText('+₹60,000').length).toBeGreaterThan(0);
  });

  it('lists every balance at both ends so nothing has to be computed by hand', async () => {
    render(<SeasonalityHeatmap transactions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Oct FY26-27 movement/i }));
    await screen.findByText('Every balance at both ends');

    const sheetRow = (label: string) => screen.getByText(label).closest('tr')!;
    // Unchanged balances are shown too, not just the one that moved.
    expect(sheetRow('Stock holdings value')).toHaveTextContent('₹5,00,000₹5,00,000₹0');
    expect(sheetRow('Operating Cash')).toHaveTextContent('₹20,000₹20,000₹0');
    expect(sheetRow('Cash Reserve (Vault)')).toHaveTextContent('₹90,000₹1,50,000+₹60,000');
    expect(sheetRow('PF (PPF/EPF)')).toHaveTextContent('₹1,00,000₹1,00,000₹0');
    expect(sheetRow('Liabilities (subtracted)')).toHaveTextContent('-₹10,000-₹10,000₹0');
    expect(sheetRow('Net worth')).toHaveTextContent('₹7,00,000₹7,60,000+₹60,000');
    // The percentage-point and share formulas are spelled out with the real numbers.
    expect(screen.getByText(/Pts = Change ÷ ₹7,00,000 × 100 · Share = Change ÷ \+₹60,000 × 100/)).toBeInTheDocument();
  });

  it('warns when a symbol traded in the month has no stored price (snapshots value it at ₹0)', async () => {
    render(
      <SeasonalityHeatmap
        transactions={[{ id: 't', symbol: 'NEWCO', type: 'BUY', quantity: 5, price: 100, date: '2026-10-01' }]}
        currentPrices={{ TCS: 3_000 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Oct FY26-27 movement/i }));
    expect(await screen.findByText(/NEWCO has no stored price/)).toBeInTheDocument();
  });

  it('does not warn when every traded symbol has a stored price', async () => {
    render(
      <SeasonalityHeatmap
        transactions={[{ id: 't', symbol: 'TCS', type: 'BUY', quantity: 5, price: 100, date: '2026-10-01' }]}
        currentPrices={{ TCS: 3_000 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Oct FY26-27 movement/i }));
    await screen.findByText(/Event ledger/);
    expect(screen.queryByText(/has no stored price/)).not.toBeInTheDocument();
  });

  it('does not make empty cells clickable', () => {
    render(<SeasonalityHeatmap transactions={[]} />);
    // Only October has an opening snapshot (September); every other month is empty.
    expect(screen.getAllByRole('button', { name: /Show source calculation/i })).toHaveLength(1);
  });

  it('masks every amount in the audit when privacy mode is on', async () => {
    vi.mocked(usePrivacy).mockReturnValue({ hidden: true, toggle: vi.fn() } as unknown as ReturnType<typeof usePrivacy>);
    render(<SeasonalityHeatmap transactions={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Oct FY26-27 movement/i }));
    await screen.findByText(/Event ledger/);

    expect(screen.queryByText(/1,50,000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/7,60,000/)).not.toBeInTheDocument();
  });
});
