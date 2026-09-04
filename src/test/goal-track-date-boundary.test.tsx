// Covers the DATE-boundary bug flagged in TODO.md's timezone-date-boundary-bug item for
// src/pages/GoalTrack.tsx: `goal.target_date` is a bare Postgres DATE string ('YYYY-MM-DD', no
// time/offset). Both the goal-card "days left" badge and the detail dialog's "Days Left" stat used
// to parse it with bare `new Date(goal.target_date)`, which JS reads as UTC midnight — later than
// local midnight in a timezone ahead of UTC (verified under IST, UTC+5:30). Comparing that against
// `Date.now()`/`new Date()` (both real local instants) over-counts "days left" by one during the
// ~5.5-hour window right after local midnight (00:00–05:29 IST), the same window documented in
// dateUtils.test.ts for todayLocalDateString. Fixed by parsing target_date with `parseLocalDate`.
//
// Follows the goal-track-timeline.test.tsx convention: mock usePortfolio and the supabase client
// directly, only faking `Date` (not timers) so testing-library's waitFor still ticks — see
// reports-page.test.tsx for that same pattern.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderPage() {
  return render(
    <MemoryRouter>
      <GoalTrack />
    </MemoryRouter>,
  );
}

describe('GoalTrack — target_date DATE-boundary handling', () => {
  beforeEach(() => {
    goalRows.length = 0;
    allocationRows.length = 0;
    mockedUsePortfolio.mockReturnValue({
      holdings: [],
      cash: { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 },
      loading: false,
    } as unknown as ReturnType<typeof usePortfolio>);
    // Only fake Date (not setTimeout/setInterval) so testing-library's waitFor still ticks — same
    // approach as reports-page.test.tsx.
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2:00 AM IST local on 2026-01-05 — inside the 00:00-05:29 IST window where UTC-midnight
    // misparse of a DATE-only string differs from local midnight by a full calendar day.
    vi.setSystemTime(new Date(2026, 0, 5, 2, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts "days left" from local midnight, not UTC midnight, on the goal card', async () => {
    // target_date is 5 calendar days after "today" (2026-01-05 local) — a bare DATE string, the
    // exact shape Postgres returns, deliberately NOT built via .toISOString() (a full timestamp,
    // which never triggers this bug — see goal-track-timeline.test.tsx's fixtures for that case).
    goalRows.push({
      id: 'g1',
      name: 'Emergency Fund',
      category: 'Safety',
      target_amount: 500000,
      target_date: '2026-01-10',
      icon: 'PiggyBank',
      notes: null,
      created_at: new Date(2025, 0, 1).toISOString(),
    });

    renderPage();

    // Under the old bare `new Date(target_date)` parse this read "6d left" (UTC midnight on
    // 2026-01-10 is 123.5h away from this local instant, ceil'ing up an extra day); the correct,
    // local-midnight-anchored count is 5.
    await waitFor(() => expect(screen.getByText(/5d left/)).toBeInTheDocument());
    expect(screen.queryByText(/6d left/)).not.toBeInTheDocument();
  });

  it('counts "Days Left" the same way in the goal detail dialog', async () => {
    goalRows.push({
      id: 'g1',
      name: 'Emergency Fund',
      category: 'Safety',
      target_amount: 500000,
      target_date: '2026-01-10',
      icon: 'PiggyBank',
      notes: null,
      created_at: new Date(2025, 0, 1).toISOString(),
    });

    renderPage();
    fireEvent.click(await screen.findByText('Emergency Fund'));

    await waitFor(() => expect(screen.getByText('Days Left')).toBeInTheDocument());
    expect(screen.getByText('5 days')).toBeInTheDocument();
  });
});
