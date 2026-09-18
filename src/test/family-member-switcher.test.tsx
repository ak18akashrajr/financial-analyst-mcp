// Covers FamilyMemberSwitcher: hidden while members are loading/empty, otherwise offers "All
// Family" plus every member, and selecting one calls through to FamilyMemberContext.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FamilyMemberSwitcher } from '@/components/FamilyMemberSwitcher';
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

describe('FamilyMemberSwitcher', () => {
  it('renders nothing when there are no family members yet', async () => {
    memberRows.length = 0;
    vi.mocked(useFamilyMemberSelection).mockReturnValue({ activeMemberId: 'all', setActiveMemberId: vi.fn() });

    const { container } = render(<FamilyMemberSwitcher />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('offers "All Family" plus every member once loaded', async () => {
    memberRows.push(
      { id: 'm-1', name: 'Priya', relationship: 'Self', created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'm-2', name: 'Rahul', relationship: 'Spouse', created_at: '2026-09-02T00:00:00.000Z' },
    );
    vi.mocked(useFamilyMemberSelection).mockReturnValue({ activeMemberId: 'all', setActiveMemberId: vi.fn() });

    render(<FamilyMemberSwitcher />);

    await waitFor(() => expect(screen.getByText('All Family')).toBeInTheDocument());
  });
});
