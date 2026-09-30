// Covers a mobile-overflow regression on the "Last fetch attempt chain" list
// (src/pages/DollarAdjustedReturns.tsx): the note span had `truncate` but no
// `min-w-0`, so a long diagnostic message from the FX-fetch edge function
// rendered at full width instead of being clipped, forcing page-wide
// horizontal scroll on phones (no overflow-x-auto ancestor, and the app has
// no overflow-x:hidden safety net on body/html).
// Follows the repo convention (CLAUDE.md) of mocking hooks directly via
// vi.mock rather than driving real Supabase/context providers underneath —
// see src/test/exposure-section.test.tsx for the pattern this extends.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DollarAdjustedReturns from '@/pages/DollarAdjustedReturns';

// SiteFooter (rendered by every page) pulls in useActiveMemberName -> useFamilyMembers, which
// talks to supabase directly — stub the client so it never tries to read env vars.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));

const metrics = {
  aumUsd: 1000,
  investedUsd: 900,
  currentUsd: 1000,
  alphaUsd: 100,
  alphaInr: 8000,
  inrReturnPct: 10,
  usdReturnPct: 11,
  currencyDragPct: -1,
  attr: { avgEntryRate: 83, assetReturnPct: 10, currencyEffectPct: 1, totalUsdReturnPct: 11 },
  xirrInr: 10,
  xirrUsd: 11,
  flows: [] as unknown[],
  holdingRows: [] as unknown[],
  coverageOk: true,
  approximatedCount: 0,
};

const LONG_NOTE = 'HTTP 429 rate limited by Yahoo Finance, falling back to Frankfurter (ECB) reference rate for 2026-09-27';

vi.mock('@/hooks/useDollarReturns', () => ({
  useDollarReturns: () => ({
    loading: false,
    rates: [],
    spot: 83.12,
    spotRow: { source: 'yahoo', date: '2026-09-27' },
    metrics,
    loadingFx: false,
    refreshing: false,
    backfilling: false,
    refreshFx: vi.fn(),
    backfillFx: vi.fn(),
    lastAttempts: [{ source: 'yahoo', ok: false, note: LONG_NOTE }],
  }),
}));

vi.mock('@/hooks/useNetWorthHistory', () => ({
  useNetWorthHistory: () => ({ data: [] }),
}));

describe('DollarAdjustedReturns fetch-attempt chain', () => {
  it('lets a long diagnostic note actually shrink and clip instead of forcing page-wide overflow', () => {
    render(
      <MemoryRouter>
        <DollarAdjustedReturns />
      </MemoryRouter>,
    );

    const noteSpan = screen.getByText(LONG_NOTE);
    expect(noteSpan).toHaveClass('truncate', 'min-w-0', 'flex-1');
  });
});
