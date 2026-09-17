import { useState } from 'react';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Users2 } from 'lucide-react';

const RELATIONSHIP_OPTIONS = ['Self', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

export default function FamilyMembers() {
  const { members, loading, addMember, deleteMember } = useFamilyMembers();
  const { activeMemberId, setActiveMemberId } = useFamilyMemberSelection();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIP_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const created = await addMember(trimmed, relationship);
    setSubmitting(false);
    if (created) {
      setName('');
      setRelationship(RELATIONSHIP_OPTIONS[0]);
    }
  };

  const handleDelete = async (id: string) => {
    const removed = await deleteMember(id);
    // Deleting the currently-active member falls back to the combined view rather than
    // leaving the switcher pointed at a member that no longer exists.
    if (removed && activeMemberId === id) setActiveMemberId('all');
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center">
          <Users2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Family Members</h1>
          <p className="text-sm text-muted-foreground">
            Add family members to track their portfolios separately, or switch to the combined
            "All Family" view from the nav.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a family member</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="member-name">Name</Label>
            <Input
              id="member-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="w-full sm:w-40 space-y-1.5">
            <Label htmlFor="member-relationship">Relationship</Label>
            <select
              id="member-relationship"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleAdd} disabled={submitting || !name.trim()}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No family members yet — add one above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.relationship}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(m.id)}
                    title="Remove"
                    aria-label={`Remove ${m.name}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
