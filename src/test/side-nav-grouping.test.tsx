// SideNav groups its items under small section labels (Analytics / Planning /
// Tools) instead of one flat list — this covers that grouping renders
// correctly and every route is still reachable.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SideNav } from '@/components/SideNav';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// SideNav now also mounts FamilyMemberSwitcher (useFamilyMembers → family_members table) —
// same convention as app-layout.test.tsx's supabase mock for SecurityIncidentsProvider.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'family_members' || table === 'family_member_deletions') {
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
    ['Charts', 'Benchmark', 'Rolling', 'Taxes', 'Forecast', 'Goals', 'AI', 'Dev Zone'].forEach((label) => {
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
    // Icon-only links keep an accessible name (aria-label) now that the native title tooltip is gone
    expect(screen.getByLabelText('Charts')).toBeInTheDocument();

    localStorage.removeItem('sidenav_collapsed');
  });

  it('uses Radix tooltips and aria-labels instead of native title attributes when collapsed', () => {
    localStorage.setItem('sidenav_collapsed', '1');
    const { container } = render(
      <MemoryRouter initialEntries={['/overview']}>
        <SideNav />
      </MemoryRouter>,
    );
    expect(container.querySelector('aside [title]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    localStorage.removeItem('sidenav_collapsed');
  });

  it('renders one sliding pill behind the current page link and moves it when the route changes', () => {
    function Go() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/reports')}>go</button>;
    }
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SideNav />
        <Go />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId('nav-active-pill')).toHaveLength(1);
    const overview = screen.getByRole('link', { name: /overview/i });
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(overview).toHaveClass('text-background');
    expect(overview).not.toHaveClass('bg-foreground');

    fireEvent.click(screen.getByText('go'));
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /reports/i })).toHaveClass('text-background');
    expect(screen.getAllByTestId('nav-active-pill')).toHaveLength(1);
  });

  it('re-measures the pill when the sidebar becomes visible after load (it is display:none below md, so every link measured 0x0)', async () => {
    // jsdom has no layout; drive offsetTop/Left/Width/Height from a variable we can change mid-test.
    const box = { top: 0, left: 0, width: 0, height: 0 };
    const defs: Array<[string, () => number]> = [
      ['offsetTop', () => box.top], ['offsetLeft', () => box.left],
      ['offsetWidth', () => box.width], ['offsetHeight', () => box.height],
    ];
    const originals = defs.map(([k]) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
    defs.forEach(([k, get]) => Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get }));

    let notify: (() => void) | undefined;
    const OriginalRO = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(cb: () => void) { notify = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;

    try {
      render(<MemoryRouter initialEntries={['/overview']}><SideNav /></MemoryRouter>);
      const pill = screen.getByTestId('nav-active-pill');
      expect(pill).toHaveStyle({ width: '0px', height: '0px' });

      // The viewport grows past md: the sidebar is now laid out and the nav's box changes.
      box.top = 196; box.left = 12; box.width = 209; box.height = 40;
      notify?.();
      await waitFor(() => expect(screen.getByTestId('nav-active-pill')).toHaveStyle({ width: '209px', height: '40px', top: '196px' }));

      // ...and a plain window resize also re-measures.
      box.top = 240;
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(screen.getByTestId('nav-active-pill')).toHaveStyle({ top: '240px' }));
    } finally {
      window.ResizeObserver = OriginalRO;
      originals.forEach(([k, d]) => d && Object.defineProperty(HTMLElement.prototype, k, d));
    }
  });
});
