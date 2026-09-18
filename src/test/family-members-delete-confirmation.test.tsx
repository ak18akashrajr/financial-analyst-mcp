// Covers the GitHub-style delete-confirmation flow on src/pages/FamilyMembers.tsx: deleting a
// member used to be one unguarded click (see useFamilyMembers.deleteMember's old signature) —
// it now requires typing the member's exact name, a reason, and who's performing the delete,
// and the confirm button stays disabled until all three are satisfied. Follows the repo
// convention (CLAUDE.md, src/test/exposure-section.test.tsx) of mocking the data hook directly.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FamilyMembers from '@/pages/FamilyMembers';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';

vi.mock('@/hooks/useFamilyMembers', () => ({ useFamilyMembers: vi.fn() }));
vi.mock('@/contexts/FamilyMemberContext', () => ({ useFamilyMemberSelection: vi.fn() }));

const mockedUseFamilyMembers = vi.mocked(useFamilyMembers);
const mockedUseFamilyMemberSelection = vi.mocked(useFamilyMemberSelection);

describe('FamilyMembers — delete confirmation', () => {
  const deleteMember = vi.fn();
  const setActiveMemberId = vi.fn();

  beforeEach(() => {
    deleteMember.mockReset().mockResolvedValue(true);
    setActiveMemberId.mockReset();
    mockedUseFamilyMembers.mockReturnValue({
      members: [{ id: 'm-1', name: 'Priya', relationship: 'Spouse', createdAt: '2026-09-01T00:00:00.000Z' }],
      deletionLog: [],
      loading: false,
      addMember: vi.fn(),
      updateMember: vi.fn(),
      deleteMember,
      reload: vi.fn(),
    } as never);
    mockedUseFamilyMemberSelection.mockReturnValue({ activeMemberId: 'all', setActiveMemberId });
  });

  function openDialog() {
    render(<FamilyMembers />);
    fireEvent.click(screen.getByRole('button', { name: /remove priya/i }));
  }

  it('keeps the delete button disabled until the name, reason, and deleter are all filled in', () => {
    openDialog();
    const confirmButton = screen.getByRole('button', { name: 'Delete Priya' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type.*to confirm/i), { target: { value: 'Priya' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason for deletion/i), { target: { value: 'Added by mistake' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Akash' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('does not enable the delete button on a partial/incorrect name match', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText(/type.*to confirm/i), { target: { value: 'Pri' } });
    fireEvent.change(screen.getByLabelText(/reason for deletion/i), { target: { value: 'Added by mistake' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Akash' } });
    expect(screen.getByRole('button', { name: 'Delete Priya' })).toBeDisabled();
  });

  it('calls deleteMember with the id, reason, and deleter once confirmed', async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText(/type.*to confirm/i), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText(/reason for deletion/i), { target: { value: 'Added by mistake' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Akash' } });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Priya' }));

    await waitFor(() => expect(deleteMember).toHaveBeenCalledWith('m-1', 'Added by mistake', 'Akash'));
  });

  it('resets the active member selection to "all" when the deleted member was the active one', async () => {
    mockedUseFamilyMemberSelection.mockReturnValue({ activeMemberId: 'm-1', setActiveMemberId });
    openDialog();
    fireEvent.change(screen.getByLabelText(/type.*to confirm/i), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText(/reason for deletion/i), { target: { value: 'reason' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Akash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Priya' }));

    await waitFor(() => expect(setActiveMemberId).toHaveBeenCalledWith('all'));
  });

  it('shows the deletion history with who deleted whom and why', () => {
    mockedUseFamilyMembers.mockReturnValue({
      members: [],
      deletionLog: [
        {
          id: 'd-1',
          memberId: 'm-0',
          memberName: 'Rahul',
          memberRelationship: 'Child',
          reason: 'Left the household',
          deletedBy: 'Akash',
          deletedAt: '2026-09-18T00:00:00.000Z',
        },
      ],
      loading: false,
      addMember: vi.fn(),
      updateMember: vi.fn(),
      deleteMember,
      reload: vi.fn(),
    } as never);

    render(<FamilyMembers />);
    expect(screen.getByText('Deletion History')).toBeInTheDocument();
    expect(screen.getByText(/Rahul/)).toBeInTheDocument();
    expect(screen.getByText(/Deleted by/)).toBeInTheDocument();
    expect(screen.getByText(/Akash/)).toBeInTheDocument();
    expect(screen.getByText(/Left the household/)).toBeInTheDocument();
  });
});
