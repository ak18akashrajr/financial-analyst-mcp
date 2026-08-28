// Landing.tsx is the public "/" route — the fix for the sidebar showing on
// an unauthenticated visit (App.tsx used to mount SideNav/MobileTopNav
// unconditionally). A signed-out visitor should see a bare splash with a
// single Login CTA and no nav; a signed-in visitor should never see the
// splash at all.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Landing from '@/pages/Landing';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/overview" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Landing', () => {
  it('shows a loading state while the session is being resolved', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: true, signIn: vi.fn(), signOut: vi.fn() });
    renderLanding();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the brand splash and a single Login link when signed out', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn: vi.fn(), signOut: vi.fn() });
    renderLanding();
    expect(screen.getByText('Blackcrest Capital Holdings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('redirects straight to the dashboard when a session already exists', () => {
    mockedUseAuth.mockReturnValue({
      session: { access_token: 'fake' } as never,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    renderLanding();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Blackcrest Capital Holdings')).not.toBeInTheDocument();
  });
});
