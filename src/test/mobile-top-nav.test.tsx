// MobileTopNav is the only nav surface on phone widths (SideNav is `hidden
// md:flex`). Its links live inside a hamburger-triggered Sheet drawer rather
// than an always-visible strip, so tests open the drawer before asserting on
// links. This covers: every route is still reachable from the drawer,
// react-router marks the active one (via aria-current, not a brittle class
// check), the logout icon-button carries an accessible name now that it no
// longer has visible text, and the drawer closes after a link is clicked.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileTopNav } from '@/components/MobileTopNav';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// MobileTopNav now also mounts FamilyMemberSwitcher (useFamilyMembers → family_members table) —
// same convention as app-layout.test.tsx's supabase mock for SecurityIncidentsProvider.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'family_members') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mocked(useAuth).mockReturnValue({
  session: { access_token: 'fake' } as never,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
});

describe('MobileTopNav', () => {
  it('renders every route in the drawer and marks the current route active', () => {
    render(
      <MemoryRouter initialEntries={['/charts']}>
        <MobileTopNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    ['Overview', 'Charts', 'Reports', 'Benchmark', 'Taxes', 'Projections', 'Forecast', 'AI', 'Dev Zone'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    expect(screen.getByText('Charts').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Overview').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('closes the drawer after a link is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <MobileTopNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByText('Charts')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Charts'));
    expect(screen.queryByText('Dev Zone')).not.toBeInTheDocument();
  });

  it('gives the icon-only logout button an accessible name', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <MobileTopNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});
