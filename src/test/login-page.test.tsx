// Login.tsx is the public "/login" route. It's a thin wrapper around
// LoginForm (see login-form.test.tsx for form/redirect behavior) whose only
// job is to skip the form entirely if a session already exists.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Login from '@/pages/Login';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/overview" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Login page', () => {
  it('shows a loading state while the session is being resolved', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: true, signIn: vi.fn(), signOut: vi.fn() });
    renderLogin();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the login form when signed out', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn: vi.fn(), signOut: vi.fn() });
    renderLogin();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('redirects to the dashboard instead of showing the form when already signed in', () => {
    mockedUseAuth.mockReturnValue({
      session: { access_token: 'fake' } as never,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    renderLogin();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
  });
});
