// The Projections "Goals" tab must show the same "currently allocated" figure as the Goal Tracker (audit
// M10). It used to multiply the allocation's stored `quantity` snapshot by the price and skip clamping, so a
// `track_max` row (stored qty 10, 20 units held @ ₹1,500) read ₹15,000 here against ₹30,000 on Goal Tracker —
// and the goal Monte Carlo's start corpus and P(goal met) inherited the stale number.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Projections from '@/pages/Projections';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('@/hooks/usePortfolio', () => ({ usePortfolio: vi.fn() }));
const mockedUsePortfolio = vi.mocked(usePortfolio);

const { goalRows, allocationRows } = vi.hoisted(() => ({
  goalRows: [
    {
      id: 'g1',
      name: 'Retirement Corpus',
      category: 'Retirement',
      target_amount: 10_000_000,
      target_date: '2040-01-01',
      icon: 'Target',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
    },
  ] as Array<Record<string, unknown>>,
  allocationRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () =>
        Promise.resolve({
          data: table === 'goals' ? goalRows : table === 'goal_allocations' ? allocationRows : [],
          error: null,
        }),
    }),
  },
}));

function mockPortfolio(totalQuantity: number, currentPrice: number) {
  mockedUsePortfolio.mockReturnValue({
    summary: {
      investedValue: 100_000, currentValue: 120_000, totalPnl: 20_000, totalPnlPercent: 20,
      liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0, totalPortfolioValue: 120_000, xirr: 15, xirrExPf: 15,
    },
    exposure: { category: [], geography: [] },
    holdings: [
      { symbol: 'ACME', totalQuantity, currentPrice, avgPrice: currentPrice, totalInvested: 0, currentValue: 0, pnl: 0, pnlPercent: 0, transactions: [] },
    ],
    cash: { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 },
    // The page's old calculation read this map directly; the fix reads each holding's own currentPrice.
    currentPrices: { ACME: currentPrice },
    loading: false,
  } as unknown as ReturnType<typeof usePortfolio>);
}

/** The goal header line containing "Currently allocated: ₹…". */
const allocatedLine = () => screen.getByText(/Currently allocated:/);

async function openGoalsTab() {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <Projections />
      </TooltipProvider>
    </MemoryRouter>,
  );
  // Radix Tabs activates on mousedown, not click.
  fireEvent.mouseDown(await screen.findByRole('tab', { name: /goals/i }), { button: 0 });
}

describe('Projections — goals "currently allocated" matches Goal Tracker (audit M10)', () => {
  it('resolves a track_max allocation against the live holding, not its stored quantity snapshot', async () => {
    allocationRows.length = 0;
    allocationRows.push({ id: 'a1', goal_id: 'g1', source_type: 'symbol', symbol: 'ACME', amount: 0, quantity: 10, track_max: true });
    mockPortfolio(20, 1500);

    await openGoalsTab();

    // The goals/allocations load asynchronously, so wait for the value rather than just the label.
    await waitFor(() => expect(allocatedLine().textContent).toContain('₹30.0K')); // 20 live units x ₹1,500 (GoalProjection formats compactly)
    expect(allocatedLine().textContent).not.toContain('₹15.0K'); // the stale stored-quantity figure (10 x ₹1,500)
  });

  it('clamps an over-allocation to the units actually held instead of counting units that do not exist', async () => {
    allocationRows.length = 0;
    // A fixed claim of 50 units against a 20-unit holding: the Goal Tracker scales it down to 20.
    allocationRows.push({ id: 'a1', goal_id: 'g1', source_type: 'symbol', symbol: 'ACME', amount: 0, quantity: 50, track_max: false });
    mockPortfolio(20, 100);

    await openGoalsTab();

    await waitFor(() => expect(allocatedLine().textContent).toContain('₹2.0K')); // 20 x ₹100
    expect(allocatedLine().textContent).not.toContain('₹5.0K'); // 50 x ₹100 would count units that do not exist
  });
});
