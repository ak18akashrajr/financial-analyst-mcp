// MobileTopNav is the only nav surface on phone widths (SideNav is `hidden
// md:flex`). This covers the precision fixes made for it: every tab is still
// reachable, react-router marks the active one (via aria-current, not a
// brittle class check), and the logout icon-button carries an accessible
// name now that it no longer has visible text.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileTopNav } from '@/components/MobileTopNav';
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

describe('MobileTopNav', () => {
  it('renders every tab and marks the current route active', () => {
    render(
      <MemoryRouter initialEntries={['/charts']}>
        <MobileTopNav />
      </MemoryRouter>,
    );

    ['Overview', 'Charts', 'Reports', 'Benchmark', 'Taxes', 'Projections', 'AI', 'Dev Zone'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    expect(screen.getByText('Charts').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Overview').closest('a')).not.toHaveAttribute('aria-current');
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
