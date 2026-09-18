// Covers useActiveMemberName: resolves the greeting/footer name for the current family-member
// selection — "Fam" for the combined "All Family" view, "Akash" for the seeded Self member, and
// the actual name for anyone else. Mocks the context/hook it consumes directly (repo convention,
// CLAUDE.md), rather than wrapping a real FamilyMemberProvider around the tree.
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActiveMemberName } from '@/hooks/useActiveMemberName';

const { selectionMock, membersMock } = vi.hoisted(() => ({
  selectionMock: vi.fn(),
  membersMock: vi.fn(),
}));

vi.mock('@/contexts/FamilyMemberContext', () => ({ useFamilyMemberSelection: selectionMock }));
vi.mock('@/hooks/useFamilyMembers', () => ({ useFamilyMembers: membersMock }));

describe('useActiveMemberName', () => {
  it('returns "Fam" for the combined "All Family" view', () => {
    selectionMock.mockReturnValue({ activeMemberId: 'all' });
    membersMock.mockReturnValue({ members: [{ id: 'm-1', name: 'Self', relationship: 'Self' }] });

    const { result } = renderHook(() => useActiveMemberName());
    expect(result.current).toBe('Fam');
  });

  it('returns "Akash" for the seeded Self member', () => {
    selectionMock.mockReturnValue({ activeMemberId: 'm-1' });
    membersMock.mockReturnValue({ members: [{ id: 'm-1', name: 'Self', relationship: 'Self' }] });

    const { result } = renderHook(() => useActiveMemberName());
    expect(result.current).toBe('Akash');
  });

  it("returns a non-self member's actual name", () => {
    selectionMock.mockReturnValue({ activeMemberId: 'm-2' });
    membersMock.mockReturnValue({
      members: [
        { id: 'm-1', name: 'Self', relationship: 'Self' },
        { id: 'm-2', name: 'Priya', relationship: 'Spouse' },
      ],
    });

    const { result } = renderHook(() => useActiveMemberName());
    expect(result.current).toBe('Priya');
  });
});
