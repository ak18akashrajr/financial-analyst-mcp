// DeploymentPlan.tsx had its own "Logout" button that predated real Supabase Auth: it cleared a
// long-retired sessionStorage flag ('portfolio_auth', from the old hardcoded LoginGate — see
// docs/auth-rls-plan.md) and reloaded the page. Since AuthContext's real session lives under
// Supabase's own sessionStorage key (set via supabase.auth.signInWithPassword), that button never
// actually signed the user out — the reload just found the still-valid session and bounced them
// straight back in. Every other logout entry point (SideNav, MobileTopNav) already calls the real
// signOut() from useAuth(); this page's button now does the same. See ADR discussion in chat
// 2026-09-18.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import DeploymentPlan from '@/pages/DeploymentPlan';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));

vi.mock('@/components/deployment/MarketRegimeStrip', () => ({
  MarketRegimeStrip: () => null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {},
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUsePortfolio = vi.mocked(usePortfolio);

describe('DeploymentPlan logout button', () => {
  it('calls the real signOut() instead of touching the retired portfolio_auth flag', () => {
    const signOut = vi.fn();
    mockedUseAuth.mockReturnValue({
      session: { access_token: 'fake' } as never,
      loading: false,
      signIn: vi.fn(),
      signOut,
    });
    mockedUsePortfolio.mockReturnValue({ holdings: [] } as never);

    render(
      <MemoryRouter>
        <TooltipProvider>
          <DeploymentPlan />
        </TooltipProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
