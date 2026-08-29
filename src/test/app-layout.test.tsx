// AppLayout is the fix for SideNav/MobileTopNav previously being mounted
// unconditionally at the app root (visible even on the login screen). It's
// now nested inside <ProtectedRoute> in App.tsx, so it should only ever
// render together with the authenticated page content it wraps.
//
// AppLayout also mounts SecurityIncidentsProvider (docs/session-hijack-
// detection-plan.md §4), which queries security_incidents on mount — that
// needs a supabase mock now, same convention as dev-zone.test.tsx.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

const { incidentRows } = vi.hoisted(() => ({
  incidentRows: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'security_incidents') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: incidentRows, error: null }) }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

function renderLayout(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/overview']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/overview" element={<div>Dashboard Content</div>} />
          <Route path="/reports" element={<div>Reports Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    incidentRows.length = 0;
  });

  it('renders the sidebar/mobile nav alongside the routed page content', async () => {
    renderLayout();

    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    // Both SideNav and MobileTopNav render a "Blackcrest Capital..." brand
    // mark (one hidden on desktop via CSS, the other on mobile, but both
    // present in the DOM under jsdom) — two matches confirms AppLayout
    // mounted both nav components alongside the routed content.
    expect(screen.getAllByText(/Blackcrest Capital/i).length).toBeGreaterThanOrEqual(2);

    // Let the incident-check effect settle so it doesn't leak into other tests.
    await waitFor(() => expect(incidentRows).toEqual([]));
  });

  it('does not show the security banner when there are no unacknowledged incidents', async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByText('Dashboard Content')).toBeInTheDocument());
    expect(screen.queryByText(/suspicious activity detected/i)).not.toBeInTheDocument();
  });

  it('shows the security banner linking to the Security tab when an incident is unacknowledged', async () => {
    incidentRows.push({
      id: '1', detected_at: '2026-08-29T03:32:34Z', session_id: 'abc', table_name: 'cash_settings',
      operation: 'update', row_id: 'row-1', old_values: {}, new_values: {}, ip: '1.2.3.4',
      user_agent: 'curl/8.21.0', acknowledged: false,
    });
    renderLayout();

    const banner = await screen.findByText(/suspicious activity detected/i);
    expect(banner.closest('a')).toHaveAttribute('href', '/dev-zone?tab=security');
  });

  it('does not play the post-login entrance animation on a normal visit', async () => {
    renderLayout(['/overview']);
    await waitFor(() => expect(screen.getByText('Dashboard Content')).toBeInTheDocument());
    expect(screen.getByTestId('app-content')).not.toHaveClass('animate-in');
  });

  it('plays the post-login entrance animation when LoginForm hands off with state.justLoggedIn', async () => {
    renderLayout([{ pathname: '/overview', state: { justLoggedIn: true } }]);
    await waitFor(() => expect(screen.getByText('Dashboard Content')).toBeInTheDocument());
    expect(screen.getByTestId('app-content')).toHaveClass('animate-in');
  });
});
