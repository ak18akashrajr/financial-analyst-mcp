import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { Users } from 'lucide-react';

/** Dropdown driving every usePortfolio() consumer's active member selection — "All Family" for
 * the combined household view, or one specific member. See FamilyMemberContext. */
export function FamilyMemberSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { activeMemberId, setActiveMemberId } = useFamilyMemberSelection();
  const { members, loading } = useFamilyMembers();

  if (loading || members.length === 0) return null;

  if (collapsed) {
    return (
      <div className="flex items-center justify-center h-10 w-10 mx-auto rounded-lg text-muted-foreground" title="Family member">
        <Users className="w-4 h-4" />
      </div>
    );
  }

  return (
    <Select value={activeMemberId} onValueChange={setActiveMemberId}>
      <SelectTrigger className="w-full text-[13px]">
        <SelectValue placeholder="All Family" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Family</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name} <span className="text-muted-foreground">· {m.relationship}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
