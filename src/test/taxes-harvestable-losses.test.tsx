// Covers the "Harvestable Losses" section added to the Taxes page (docs/feature-ideas.md #3):
// empty state, listing loss lots sorted biggest-loss-first, the same-day re-entry ⚠ flag, and
// privacy masking. Mocks the Supabase client directly (CLAUDE.md convention) rather than driving
// a real fetch — see src/test/benchmark-page.test.tsx for the same pattern on a data-fetching page.
// generateTaxReport/getHarvestableLots/hasSameDayReentry's own math is covered by
// src/test/tax-calculator.test.ts; this only checks the page wires them together correctly.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Taxes from '@/pages/Taxes';

const { txnRows, priceRows, metaRows } = vi.hoisted(() => ({
  txnRows: [] as { id: string; symbol: string; type: string; quantity: number; price: number; date: string }[],
  priceRows: [] as { symbol: string; price: number }[],
  metaRows: [] as { symbol: string; sector: string }[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'transactions' ? txnRows : table === 'current_prices' ? priceRows : metaRows;
      return { select: () => Promise.resolve({ data: rows, error: null }) };
    },
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <Taxes />
    </MemoryRouter>,
  );
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe('Taxes page — Harvestable Losses section', () => {
  beforeEach(() => {
    txnRows.length = 0;
    priceRows.length = 0;
    metaRows.length = 0;
  });

  it('shows the clean-slate message when nothing is sitting at a loss', async () => {
    txnRows.push({ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: daysAgo(400) });
    priceRows.push({ symbol: 'TCS', price: 150 }); // gain, not a loss
    metaRows.push({ symbol: 'TCS', sector: 'Equity' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Harvestable Losses')).toBeInTheDocument());
    expect(screen.getByText(/no lots are currently sitting at a loss/i)).toBeInTheDocument();
  });

  it('lists loss lots with the harvestable amount and flags same-day re-entry', async () => {
    txnRows.push(
      { id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 200, date: daysAgo(400) }, // loss @ CMP 150
      // A same-day SELL + BUY of the same symbol elsewhere in its history — this is what the ⚠
      // wash-sale-style flag detects, independent of which lot is currently below cost.
      { id: '2', symbol: 'TCS', type: 'SELL', quantity: 1, price: 150, date: '2026-03-01T09:00:00Z' },
      { id: '3', symbol: 'TCS', type: 'BUY', quantity: 1, price: 150, date: '2026-03-01T15:00:00Z' },
    );
    priceRows.push({ symbol: 'TCS', price: 150 });
    metaRows.push({ symbol: 'TCS', sector: 'Equity' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Harvestable Losses')).toBeInTheDocument());
    expect(screen.getByText('Total Harvestable Loss')).toBeInTheDocument();
    expect(screen.getByTitle(/same-day buy \+ sell activity detected/i)).toBeInTheDocument();
  });

  it('masks the harvestable-loss figures when privacy mode hides values', async () => {
    txnRows.push({ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 200, date: daysAgo(400) });
    priceRows.push({ symbol: 'TCS', price: 150 });
    metaRows.push({ symbol: 'TCS', sector: 'Equity' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Total Harvestable Loss')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    await waitFor(() => expect(screen.getAllByText('••••••').length).toBeGreaterThan(0));
  });
});
