// Taxes page wiring for the per-category rules (audit H5): holdings with no capital-gains treatment
// (FDs, PPF/EPF, NPS) must show up as an explicit note rather than a made-up tax line, and the rates
// reference must describe the rules the calculator actually applies. The calculator's own math is covered
// by src/test/tax-calculator.test.ts; this only checks the page surfaces it. Hook-mocked per CLAUDE.md.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Taxes from '@/pages/Taxes';
import { usePortfolio } from '@/hooks/usePortfolio';

const { txnRows, priceRows, metaRows } = vi.hoisted(() => ({
  txnRows: [] as { id: string; symbol: string; type: string; quantity: number; price: number; date: string }[],
  priceRows: [] as { symbol: string; price: number }[],
  metaRows: [] as { symbol: string; sector: string }[],
}));

vi.mock('@/hooks/usePortfolio', () => ({ usePortfolio: vi.fn() }));

function mockPortfolio() {
  const currentPrices: Record<string, number> = {};
  for (const p of priceRows) currentPrices[p.symbol] = p.price;
  const symbolMetadata: Record<string, { symbol: string; geography: string; category: string }> = {};
  for (const m of metaRows) symbolMetadata[m.symbol] = { symbol: m.symbol, geography: 'India', category: m.sector };
  vi.mocked(usePortfolio).mockReturnValue({
    transactions: txnRows.map((t) => ({ ...t, type: t.type as 'BUY' | 'SELL' })),
    currentPrices,
    symbolMetadata,
    loading: false,
  } as unknown as ReturnType<typeof usePortfolio>);
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function holding(symbol: string, category: string, price: number, current: number, ageDays = 400) {
  txnRows.push({ id: `t-${symbol}`, symbol, type: 'BUY', quantity: 10, price, date: daysAgo(ageDays) });
  priceRows.push({ symbol, price: current });
  metaRows.push({ symbol, sector: category });
}

function renderPage() {
  mockPortfolio();
  return render(
    <MemoryRouter>
      <Taxes />
    </MemoryRouter>,
  );
}

describe('Taxes page — category rules (audit H5)', () => {
  beforeEach(() => {
    txnRows.length = 0;
    priceRows.length = 0;
    metaRows.length = 0;
  });

  it('lists FDs, PPF/EPF and NPS as outside the estimate instead of taxing them', async () => {
    holding('TCS', 'Equity', 100, 150);
    holding('MYFD', 'Fixed Deposits', 1000, 1080);
    holding('MYNPS', 'NPS', 500, 600);
    renderPage();

    const note = await screen.findByTestId('tax-excluded-note');
    expect(note.textContent).toContain('MYFD (Fixed Deposits)');
    expect(note.textContent).toContain('MYNPS (NPS)');
    expect(note.textContent).not.toContain('TCS');
  });

  it('shows no exclusion note when every holding has capital-gains treatment', async () => {
    holding('TCS', 'Equity', 100, 150);
    renderPage();

    await waitFor(() => expect(screen.getByText('Applicable Tax Rates (FY 2026–27)')).toBeInTheDocument());
    expect(screen.queryByTestId('tax-excluded-note')).not.toBeInTheDocument();
  });

  it('describes the rules the calculator applies: 12-month Gold/Bonds, 24-month US stocks, flat-30% crypto', async () => {
    holding('TCS', 'Equity', 100, 150);
    renderPage();

    await waitFor(() => expect(screen.getByText('Applicable Tax Rates (FY 2026–27)')).toBeInTheDocument());
    const rates = screen.getByText('Applicable Tax Rates (FY 2026–27)').closest('.p-4') as HTMLElement;

    expect(rates.textContent).toContain('Gold / Silver ETFs & Listed Bonds');
    expect(rates.textContent).toContain('LTCG (>12 months)');
    expect(rates.textContent).toContain('US Stocks / ETFs, Real Estate, Commodity, Others');
    expect(rates.textContent).toContain('LTCG (>24 months)');
    expect(rates.textContent).toContain('Crypto / Virtual Digital Assets');
    expect(rates.textContent).toContain('Flat 30%');
  });

  it('calls out the Gold and Bonds assumptions so a CA can check them', async () => {
    holding('TCS', 'Equity', 100, 150);
    renderPage();

    await waitFor(() => expect(screen.getByText(/Disclaimer:/)).toBeInTheDocument());
    const disclaimer = screen.getByText(/Disclaimer:/).parentElement as HTMLElement;
    expect(disclaimer.textContent).toContain('listed Gold/Silver ETFs');
    expect(disclaimer.textContent).toContain('physical gold and gold funds-of-funds need 24 months');
    expect(disclaimer.textContent).toContain('Bonds are assumed to be listed');
  });
});
