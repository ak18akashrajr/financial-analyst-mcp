// Covers the "Who's Watching" picker page: renders "All Family" plus every member, and picking
// one shows the personalized ProfileEnterLoadingScreen, then calls confirmProfile() and
// navigates on once that finishes (real timers — see login-loading-screen.test.tsx for the same
// pattern this mirrors, ~1.65s total for a 4-stage sequence).
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import WhosWatching from '@/pages/WhosWatching';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';

vi.mock('@/contexts/FamilyMemberContext', () => ({
  useFamilyMemberSelection: vi.fn(),
}));

const { memberRows } = vi.hoisted(() => ({
  memberRows: [] as Array<{ id: string; name: string; relationship: string; created_at: string }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'family_members') {
        return { select: () => ({ order: () => Promise.resolve({ data: memberRows, error: null }) }) };
      }
      if (table === 'family_member_deletions') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

function renderPicker(confirmProfile = vi.fn(), initialEntries: any[] = ['/select-profile']) {
  vi.mocked(useFamilyMemberSelection).mockReturnValue({
    activeMemberId: 'all',
    setActiveMemberId: vi.fn(),
    hasConfirmedProfile: false,
    confirmProfile,
  });

  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/select-profile" element={<WhosWatching />} />
        <Route path="/overview" element={<div>Dashboard</div>} />
        <Route path="/taxes" element={<div>Taxes Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WhosWatching', () => {
  it('renders "All Family" plus every member with initials-based avatars', async () => {
    memberRows.length = 0;
    memberRows.push(
      { id: 'm-1', name: 'Rethinasamy', relationship: 'Parent', created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'm-2', name: 'Balaji', relationship: 'Sibling', created_at: '2026-09-02T00:00:00.000Z' },
    );
    renderPicker();

    await waitFor(() => expect(screen.getByText('Fam')).toBeInTheDocument());
    expect(screen.getByText('Rethinasamy')).toBeInTheDocument();
    expect(screen.getByText('Balaji')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows a personalized loading screen, then confirms the picked member and navigates to the dashboard by default', async () => {
    memberRows.length = 0;
    memberRows.push({ id: 'm-1', name: 'Rethinasamy', relationship: 'Parent', created_at: '2026-09-01T00:00:00.000Z' });
    const confirmProfile = vi.fn();
    renderPicker(confirmProfile);

    await waitFor(() => expect(screen.getByText('Rethinasamy')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Rethinasamy').closest('button')!);

    expect(await screen.findByText(/hi rethinasamy, welcome back/i)).toBeInTheDocument();
    expect(confirmProfile).not.toHaveBeenCalled();

    await waitFor(() => expect(confirmProfile).toHaveBeenCalledWith('m-1'), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  });

  it('returns to the originally requested page when arriving via the profile-selection redirect', async () => {
    memberRows.length = 0;
    memberRows.push({ id: 'm-1', name: 'Rethinasamy', relationship: 'Parent', created_at: '2026-09-01T00:00:00.000Z' });
    const confirmProfile = vi.fn();
    renderPicker(confirmProfile, [
      { pathname: '/select-profile', state: { from: { pathname: '/taxes' } } },
    ]);

    await waitFor(() => expect(screen.getByText('Rethinasamy')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Rethinasamy').closest('button')!);

    await waitFor(() => expect(screen.getByText('Taxes Page')).toBeInTheDocument(), { timeout: 4000 });
  });
});
