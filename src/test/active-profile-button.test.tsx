// ActiveProfileButton is the header "switch profile" entry point — hidden while there are no
// family members yet (same convention as FamilyMemberSwitcher), otherwise shows the active
// member's avatar and navigates to /select-profile on click.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActiveProfileButton } from '@/components/ActiveProfileButton';
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

function renderButton(activeMemberId: string | 'all') {
  vi.mocked(useFamilyMemberSelection).mockReturnValue({
    activeMemberId,
    setActiveMemberId: vi.fn(),
    hasConfirmedProfile: true,
    confirmProfile: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route path="/overview" element={<ActiveProfileButton />} />
        <Route path="/select-profile" element={<div>Who's Watching Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActiveProfileButton', () => {
  it('renders nothing when there are no family members yet', async () => {
    memberRows.length = 0;
    const { container } = renderButton('all');
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows the active member's initials and navigates to /select-profile on click", async () => {
    memberRows.push({ id: 'm-1', name: 'Rethinasamy', relationship: 'Parent', created_at: '2026-09-01T00:00:00.000Z' });
    renderButton('m-1');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch profile' })).toBeInTheDocument());
    expect(screen.getByText('R')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch profile' }));
    await waitFor(() => expect(screen.getByText("Who's Watching Page")).toBeInTheDocument());
  });
});
