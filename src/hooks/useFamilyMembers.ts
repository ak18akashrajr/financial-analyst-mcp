import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { FamilyMember, FamilyMemberDeletion } from '@/types/portfolio';
import { toast } from 'sonner';
import { logClientError } from '@/lib/clientErrorLogging';

// Tables that hold per-member data — a member can only be deleted once none of these reference
// them, so removing someone never silently drops their transactions/cash/history.
const MEMBER_DATA_TABLES = ['transactions', 'cash_settings', 'monthly_cashflow', 'net_worth_history'] as const;

function toDeletionLogEntry(row: any): FamilyMemberDeletion {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberRelationship: row.member_relationship,
    reason: row.reason,
    deletedBy: row.deleted_by,
    deletedAt: row.deleted_at,
  };
}

export function useFamilyMembers() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [deletionLog, setDeletionLog] = useState<FamilyMemberDeletion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    const [membersRes, deletionsRes] = await Promise.all([
      supabase.from('family_members').select('*').order('created_at', { ascending: true }),
      supabase.from('family_member_deletions').select('*').order('deleted_at', { ascending: false }),
    ]);

    if (membersRes.error) {
      logClientError('useFamilyMembers.loadMembers', 'Failed to load family_members', { error: membersRes.error });
      toast.error('Failed to load family members');
    } else {
      setMembers(
        (membersRes.data ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          relationship: m.relationship,
          createdAt: m.created_at,
        }))
      );
    }

    if (deletionsRes.error) {
      logClientError('useFamilyMembers.loadMembers', 'Failed to load family_member_deletions', { error: deletionsRes.error });
    } else {
      setDeletionLog((deletionsRes.data ?? []).map(toDeletionLogEntry));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const addMember = useCallback(async (name: string, relationship: string) => {
    const { data, error } = await supabase
      .from('family_members')
      .insert({ name, relationship })
      .select()
      .single();

    if (error) {
      logClientError('useFamilyMembers.addMember', 'Failed to add family member', { error, name, relationship });
      toast.error('Failed to add family member');
      return null;
    }

    const newMember: FamilyMember = { id: data.id, name: data.name, relationship: data.relationship, createdAt: data.created_at };
    setMembers((prev) => [...prev, newMember]);
    toast.success(`Added ${name}`);
    return newMember;
  }, []);

  const updateMember = useCallback(async (id: string, updates: Partial<Pick<FamilyMember, 'name' | 'relationship'>>) => {
    const { error } = await supabase.from('family_members').update(updates).eq('id', id);

    if (error) {
      logClientError('useFamilyMembers.updateMember', 'Failed to update family member', { error, id, updates });
      toast.error('Failed to update family member');
      return;
    }

    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
    toast.success('Family member updated');
  }, []);

  // Blocks deletion if the member has any recorded transactions/cash/cashflow/net-worth rows —
  // there is no soft-delete or cascade here by design, see docs/family-portfolio-view-plan.md.
  // Requires a reason and who's performing the delete (GitHub-style friction — see
  // src/pages/FamilyMembers.tsx's type-to-confirm dialog) and records both to
  // family_member_deletions, snapshotting the member's name/relationship since the row itself
  // won't exist to join against afterwards.
  const deleteMember = useCallback(async (id: string, reason: string, deletedBy: string) => {
    for (const table of MEMBER_DATA_TABLES) {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('family_member_id', id);

      if (error) {
        logClientError('useFamilyMembers.deleteMember', `Failed to check ${table} before delete`, { error, id });
        toast.error('Failed to check existing data before deleting');
        return false;
      }
      if ((count ?? 0) > 0) {
        toast.error('This family member has recorded data — remove their transactions/cash entries first');
        return false;
      }
    }

    const member = members.find((m) => m.id === id);

    const { error } = await supabase.from('family_members').delete().eq('id', id);
    if (error) {
      logClientError('useFamilyMembers.deleteMember', 'Failed to delete family member', { error, id });
      toast.error('Failed to delete family member');
      return false;
    }

    setMembers((prev) => prev.filter((m) => m.id !== id));
    toast.success('Family member removed');

    // The member is already gone at this point — a failed log write is recorded but never
    // reverses or blocks the deletion that already succeeded (same fire-and-log tolerance as
    // usePortfolio's recordNetWorthSnapshot for a secondary, non-critical write).
    if (member) {
      const { data, error: logError } = await supabase
        .from('family_member_deletions')
        .insert({
          member_id: member.id,
          member_name: member.name,
          member_relationship: member.relationship,
          reason,
          deleted_by: deletedBy,
        } as any)
        .select()
        .single();

      if (logError) {
        logClientError('useFamilyMembers.deleteMember', 'Failed to record deletion log', { error: logError, id });
      } else if (data) {
        setDeletionLog((prev) => [toDeletionLogEntry(data), ...prev]);
      }
    }

    return true;
  }, [members]);

  return { members, deletionLog, loading, addMember, updateMember, deleteMember, reload: loadMembers };
}
