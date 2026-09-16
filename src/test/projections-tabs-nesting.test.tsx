// Regression test for a fix to src/pages/Projections.tsx: several <TabsTrigger> elements used to
// nest an <InfoHint> directly inside them. InfoHint renders its own <button>, and Radix's
// TabsTrigger already renders a <button role="tab">, so that was invalid HTML (button-in-button) —
// React logs it as a `validateDOMNesting` console.error, and it breaks keyboard/screen-reader
// semantics for the tab (a nested interactive control inside another one). Each hint now sits as a
// sibling right after its trigger instead. This covers both TabsList blocks on the page: the main
// Overview/Goals/FIRE/Stress Lab tabs (always rendered) and the nested XIRR/Crash/Monte
// Carlo/Sequence/Inflation tabs (rendered only after "Run All Simulations").
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Projections from '@/pages/Projections';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { PortfolioSummary, ExposureBreakdown } from '@/types/portfolio';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
const mockedUsePortfolio = vi.mocked(usePortfolio);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  },
}));

const zeroSummary: PortfolioSummary = {
  investedValue: 100_000,
  currentValue: 120_000,
  totalPnl: 20_000,
  totalPnlPercent: 20,
  liquidCash: 0,
  vaultCash: 0,
  pfBalance: 0,
  creditCardDebt: 0,
  totalPortfolioValue: 120_000,
  xirr: 15,
  xirrExPf: 15,
};

const emptyExposure: { category: ExposureBreakdown[]; geography: ExposureBreakdown[] } = {
  category: [],
  geography: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Projections />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('Projections page — no nested interactive controls in tab triggers', () => {
  beforeEach(() => {
    mockedUsePortfolio.mockReturnValue({
      summary: zeroSummary,
      exposure: emptyExposure,
      holdings: [],
      cash: { liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0 },
      currentPrices: {},
      loading: false,
    } as unknown as ReturnType<typeof usePortfolio>);
  });

  it('renders the main Overview/Goals/FIRE/Stress Lab tabs with no DOM-nesting console error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPage();
    await waitFor(() => expect(screen.getByText('Overview')).toBeInTheDocument());
    // The hint icons are real, separate elements now — not just decoration lost in the fix.
    expect(screen.getByRole('button', { name: 'What is Overview?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is Stress Lab?' })).toBeInTheDocument();

    const nestingWarning = errorSpy.mock.calls.find((args) =>
      String(args[0]).includes('cannot appear as a descendant'),
    );
    expect(nestingWarning).toBeUndefined();

    errorSpy.mockRestore();
  });

  it('renders the nested XIRR/Crash/Monte Carlo/Sequence/Inflation tabs with no DOM-nesting console error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPage();
    await waitFor(() => expect(screen.getByText('Run All Simulations')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run All Simulations'));

    await waitFor(() => expect(screen.getByText('XIRR')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'What is XIRR projection?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is Inflation impact?' })).toBeInTheDocument();

    const nestingWarning = errorSpy.mock.calls.find((args) =>
      String(args[0]).includes('cannot appear as a descendant'),
    );
    expect(nestingWarning).toBeUndefined();

    errorSpy.mockRestore();
  });
});
