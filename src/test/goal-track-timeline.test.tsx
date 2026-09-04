// Covers a fix to the Goal Detail dialog on src/pages/GoalTrack.tsx: "Time Used (1y window)" used
// to hardcode a fake 365-day window (plus dead code that fed goal.icon into `new Date(...)`)
// instead of measuring elapsed time against the goal's actual created_at → target_date span, so
// it silently read 0% for any goal more than a year out. It's now `created_at`-anchored, and
// "Days Left" also surfaces a years figure alongside the raw day count.
// Follows the repo convention (CLAUDE.md, src/test/exposure-section.test.tsx) of mocking the
// data-fetching hook directly; GoalTrack also talks to supabase directly for goals/allocations,
// so those are mocked too, the way src/test/reports-page.test.tsx does for its page.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoalTrack from '@/pages/GoalTrack';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
const mockedUsePortfolio = vi.mocked(usePortfolio);

const { goalRows, allocationRows } = vi.hoisted(() => ({
  goalRows: [] as Record<string, unknown>[],
  allocationRows: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'goals') {
        return { select: () => ({ order: () => Promise.resolve({ data: goalRows, error: null }) }) };
      }
      if (table === 'goal_allocations') {
        return { select: () => Promise.resolve({ data: allocationRows, error: null }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString();

function renderPage() {
  return render(
    <MemoryRouter>
      <GoalTrack />
    </MemoryRouter>,
  );
}

describe('GoalTrack — goal detail timeline', () => {
  beforeEach(() => {
    goalRows.length = 0;
    allocationRows.length = 0;
    mockedUsePortfolio.mockReturnValue({
      holdings: [],
      cash: { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 },
      loading: false,
    } as unknown as ReturnType<typeof usePortfolio>);
  });

  it('anchors "time used" to the goal\'s created_at → target_date span, not a fixed 365-day window', async () => {
    // created 200 days ago, target 300 days out → 500-day span, 200 elapsed → 40%
    goalRows.push({
      id: 'g1',
      name: 'House Fund',
      category: 'House',
      target_amount: 1000000,
      target_date: daysFromNow(300),
      icon: 'Home',
      notes: null,
      created_at: daysAgo(200),
    });

    renderPage();
    fireEvent.click(await screen.findByText('House Fund'));

    await waitFor(() => {
      expect(screen.getByText('Time Used (since created)')).toBeInTheDocument();
    });
    expect(screen.getByText('40%')).toBeInTheDocument();
    // Days Left should also surface a years figure alongside the raw day count.
    expect(screen.getByText('300 days')).toBeInTheDocument();
    expect(screen.getByText('≈ 0.8 yr')).toBeInTheDocument();
  });

  it('does not read 0% just because the goal is more than a year from its target', async () => {
    // A goal more than 365 days from its target date used to always show 0% under the old
    // hardcoded-365-day-window logic, regardless of how long ago it was actually created.
    goalRows.push({
      id: 'g2',
      name: 'Retirement Corpus',
      category: 'Retirement',
      target_amount: 5000000,
      target_date: daysFromNow(545), // > 365 days out
      icon: 'PiggyBank',
      notes: null,
      created_at: daysAgo(200), // but well underway
    });

    renderPage();
    fireEvent.click(await screen.findByText('Retirement Corpus'));

    await waitFor(() => {
      expect(screen.getByText('Time Used (since created)')).toBeInTheDocument();
    });
    // elapsed 200 / total (200 + 545) = 26.8% ≈ 27%
    expect(screen.getByText('27%')).toBeInTheDocument();
  });
});
