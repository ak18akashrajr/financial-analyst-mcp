// RequireProfileSelection is the route gate that redirects to /select-profile until
// confirmProfile() has been called this tab session — mirrors protected-route.test.tsx's
// pattern for the auth gate it sits behind.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireProfileSelection } from '@/components/RequireProfileSelection';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';

vi.mock('@/contexts/FamilyMemberContext', () => ({
  useFamilyMemberSelection: vi.fn(),
}));

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route path="/select-profile" element={<div>Who's Watching Page</div>} />
        <Route element={<RequireProfileSelection />}>
          <Route path="/overview" element={<div>Dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireProfileSelection', () => {
  it('redirects to /select-profile when no profile has been confirmed this session', () => {
    vi.mocked(useFamilyMemberSelection).mockReturnValue({
      activeMemberId: 'all',
      setActiveMemberId: vi.fn(),
      hasConfirmedProfile: false,
      confirmProfile: vi.fn(),
    });

    renderGate();

    expect(screen.getByText("Who's Watching Page")).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('renders the protected content once a profile has been confirmed', () => {
    vi.mocked(useFamilyMemberSelection).mockReturnValue({
      activeMemberId: 'm-1',
      setActiveMemberId: vi.fn(),
      hasConfirmedProfile: true,
      confirmProfile: vi.fn(),
    });

    renderGate();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText("Who's Watching Page")).not.toBeInTheDocument();
  });
});
