// AppLayout is the fix for SideNav/MobileTopNav previously being mounted
// unconditionally at the app root (visible even on the login screen). It's
// now nested inside <ProtectedRoute> in App.tsx, so it should only ever
// render together with the authenticated page content it wraps.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mocked(useAuth).mockReturnValue({
  session: { access_token: 'fake' } as never,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
});

describe('AppLayout', () => {
  it('renders the sidebar/mobile nav alongside the routed page content', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/overview" element={<div>Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    // Both SideNav and MobileTopNav render a "Blackcrest Capital..." brand
    // mark (one hidden on desktop via CSS, the other on mobile, but both
    // present in the DOM under jsdom) — two matches confirms AppLayout
    // mounted both nav components alongside the routed content.
    expect(screen.getAllByText(/Blackcrest Capital/i).length).toBeGreaterThanOrEqual(2);
  });
});
