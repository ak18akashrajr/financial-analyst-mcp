// Tests the centralized auth gate that replaced the old per-page <LoginGate>
// pattern. useAuth() is mocked directly so these stay unit tests, not
// integration tests against a real Supabase project.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/overview" element={<div>Secret Portfolio Data</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the session is being resolved', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: true, signIn: vi.fn(), signOut: vi.fn() });
    renderProtectedRoute();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('Secret Portfolio Data')).not.toBeInTheDocument();
  });

  it('redirects to the public /login route instead of the protected content when there is no session', () => {
    // Regression guard: /login used to be rendered inline in place of whatever
    // page was requested (no real URL change), which also meant the sidebar/
    // nav — mounted unconditionally at the app root at the time — stayed
    // visible on top of the login form. Redirecting to a real /login route
    // keeps that nav out of AppLayout's tree entirely for a signed-out visit.
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn: vi.fn(), signOut: vi.fn() });
    renderProtectedRoute();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Secret Portfolio Data')).not.toBeInTheDocument();
  });

  it('renders the protected route content when a real session exists', () => {
    mockedUseAuth.mockReturnValue({
      session: { access_token: 'fake' } as never,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    renderProtectedRoute();
    expect(screen.getByText('Secret Portfolio Data')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });
});
