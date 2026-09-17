// Covers useFamilyMembers: loading, add, update, and the delete-blocked-when-has-data guard
// (deletion is intentionally NOT soft-delete or cascade — see
// docs/family-portfolio-view-plan.md). Follows the repo convention (CLAUDE.md) of mocking the
// Supabase client directly rather than driving a real connection.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { memberRows, dataCounts, deleteMock } = vi.hoisted(() => ({
  memberRows: [] as Array<{ id: string; name: string; relationship: string; created_at: string }>,
  // Per-table row counts consulted by deleteMember before allowing a delete.
  dataCounts: { transactions: 0, cash_settings: 0, monthly_cashflow: 0, net_worth_history: 0 } as Record<string, number>,
  deleteMock: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'family_members') {
        return {
          select: () => ({ order: () => Promise.resolve({ data: memberRows, error: null }) }),
          insert: (row: { name: string; relationship: string }) => ({
            select: () => ({
              single: () => {
                const created = { id: `m-${memberRows.length + 1}`, name: row.name, relationship: row.relationship, created_at: '2026-09-17T00:00:00.000Z' };
                memberRows.push(created);
                return Promise.resolve({ data: created, error: null });
              },
            }),
          }),
          update: (updates: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              const m = memberRows.find((r) => r.id === id);
              if (m) Object.assign(m, updates);
              return Promise.resolve({ error: null });
            },
          }),
          delete: deleteMock,
        };
      }
      if (table in dataCounts) {
        return { select: () => ({ eq: () => Promise.resolve({ count: dataCounts[table], error: null }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

describe('useFamilyMembers', () => {
  beforeEach(() => {
    memberRows.length = 0;
    memberRows.push({ id: 'm-1', name: 'Priya', relationship: 'Self', created_at: '2026-09-01T00:00:00.000Z' });
    dataCounts.transactions = 0;
    dataCounts.cash_settings = 0;
    dataCounts.monthly_cashflow = 0;
    dataCounts.net_worth_history = 0;
    deleteMock.mockClear();
  });

  it('loads existing members on mount', async () => {
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toEqual([
      { id: 'm-1', name: 'Priya', relationship: 'Self', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('adds a new member and appends it to state', async () => {
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addMember('Rahul', 'Spouse');
    });

    expect(result.current.members.map((m) => m.name)).toEqual(['Priya', 'Rahul']);
    expect(result.current.members[1].relationship).toBe('Spouse');
  });

  it('updates a member\'s name/relationship', async () => {
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateMember('m-1', { relationship: 'Parent' });
    });

    expect(result.current.members[0].relationship).toBe('Parent');
  });

  it('deletes a member with no recorded data', async () => {
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean = false;
    await act(async () => {
      deleted = await result.current.deleteMember('m-1');
    });

    expect(deleted).toBe(true);
    expect(result.current.members).toEqual([]);
  });

  it('blocks deleting a member who has transactions recorded', async () => {
    dataCounts.transactions = 3;
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean = true;
    await act(async () => {
      deleted = await result.current.deleteMember('m-1');
    });

    expect(deleted).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
    // The member is still there — nothing was removed.
    expect(result.current.members).toHaveLength(1);
  });

  it('blocks deleting a member who has cash_settings data even with zero transactions', async () => {
    dataCounts.cash_settings = 1;
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean = true;
    await act(async () => {
      deleted = await result.current.deleteMember('m-1');
    });

    expect(deleted).toBe(false);
  });
});
