// SideNav groups its items under small section labels (Analytics / Planning /
// Tools) instead of one flat list — this covers that grouping renders
// correctly and every route is still reachable.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SideNav } from '@/components/SideNav';
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

describe('SideNav grouping', () => {
  it('renders the section labels and keeps every nav item present', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SideNav />
      </MemoryRouter>,
    );

    // Section headers
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();

    // Overview stays ungrouped (no section header of its own)
    expect(screen.getByText('Overview')).toBeInTheDocument();

    // A representative item from each group is still rendered
    ['Charts', 'Benchmark', 'Rolling', 'Taxes', 'Goals', 'AI', 'Dev Zone'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('hides section labels when collapsed but keeps the icons', () => {
    localStorage.setItem('sidenav_collapsed', '1');

    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SideNav />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Charts')).not.toBeInTheDocument();
    // Icon-only links still carry a title attribute for accessibility
    expect(screen.getByTitle('Charts')).toBeInTheDocument();

    localStorage.removeItem('sidenav_collapsed');
  });
});
