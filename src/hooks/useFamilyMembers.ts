import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { FamilyMember } from '@/types/portfolio';
import { toast } from 'sonner';
import { logClientError } from '@/lib/clientErrorLogging';

// Tables that hold per-member data — a member can only be deleted once none of these reference
// them, so removing someone never silently drops their transactions/cash/history.
const MEMBER_DATA_TABLES = ['transactions', 'cash_settings', 'monthly_cashflow', 'net_worth_history'] as const;

export function useFamilyMembers() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('family_members')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      logClientError('useFamilyMembers.loadMembers', 'Failed to load family_members', { error });
      toast.error('Failed to load family members');
      setLoading(false);
      return;
    }

    setMembers(
      (data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        relationship: m.relationship,
        createdAt: m.created_at,
      }))
    );
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
  const deleteMember = useCallback(async (id: string) => {
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

    const { error } = await supabase.from('family_members').delete().eq('id', id);
    if (error) {
      logClientError('useFamilyMembers.deleteMember', 'Failed to delete family member', { error, id });
      toast.error('Failed to delete family member');
      return false;
    }

    setMembers((prev) => prev.filter((m) => m.id !== id));
    toast.success('Family member removed');
    return true;
  }, []);

  return { members, loading, addMember, updateMember, deleteMember, reload: loadMembers };
}
