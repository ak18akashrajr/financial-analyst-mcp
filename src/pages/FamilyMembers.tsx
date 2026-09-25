import { useState } from 'react';
import { useFamilyMembers } from '@/hooks/useFamilyMembers';
import { useFamilyMemberSelection } from '@/contexts/FamilyMemberContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Users2, History } from 'lucide-react';
import type { FamilyMember } from '@/types/portfolio';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

const RELATIONSHIP_OPTIONS = ['Self', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

export default function FamilyMembers() {
  const { members, deletionLog, loading, addMember, deleteMember } = useFamilyMembers();
  const { activeMemberId, setActiveMemberId } = useFamilyMemberSelection();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIP_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);

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

  const handleConfirmDelete = async (reason: string, deletedBy: string) => {
    if (!deletingMember) return;
    const id = deletingMember.id;
    const removed = await deleteMember(id, reason.trim(), deletedBy.trim());
    if (removed) {
      // Deleting the currently-active member falls back to the combined view rather than
      // leaving the switcher pointed at a member that no longer exists.
      if (activeMemberId === id) setActiveMemberId('all');
      setDeletingMember(null);
    }
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
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : members.length === 0 ? (
            <EmptyState text="No family members yet — add one above." />
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
                    onClick={() => setDeletingMember(m)}
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

      {deletionLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" /> Deletion History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {deletionLog.map((d) => (
                <li key={d.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {d.memberName} <span className="text-xs font-normal text-muted-foreground">({d.memberRelationship})</span>
                    </p>
                    <p className="text-xs text-muted-foreground shrink-0">
                      {new Date(d.deletedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Deleted by <span className="text-foreground font-medium">{d.deletedBy}</span> — {d.reason}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <DeleteMemberDialog
        member={deletingMember}
        onCancel={() => setDeletingMember(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function DeleteMemberDialog({
  member, onCancel, onConfirm,
}: {
  member: FamilyMember | null;
  onCancel: () => void;
  onConfirm: (reason: string, deletedBy: string) => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [deletedBy, setDeletedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setConfirmText('');
    setReason('');
    setDeletedBy('');
    setSubmitting(false);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const canDelete = !!member && confirmText === member.name && reason.trim().length > 0 && deletedBy.trim().length > 0;

  const handleConfirmClick = async () => {
    if (!canDelete) return;
    setSubmitting(true);
    await onConfirm(reason, deletedBy);
    reset();
  };

  return (
    <AlertDialog open={!!member} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {member?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes {member?.name} as a tracked family member. This can't be undone —
            type their name to confirm and give a reason, both of which are kept in the deletion history below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm-name">
              Type <span className="font-semibold text-foreground">{member?.name}</span> to confirm
            </Label>
            <Input
              id="delete-confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delete-reason">Reason for deletion</Label>
            <Textarea
              id="delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Added by mistake, no longer tracking this member's portfolio…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delete-by">Your name</Label>
            <Input
              id="delete-by"
              value={deletedBy}
              onChange={(e) => setDeletedBy(e.target.value)}
              placeholder="Who's making this change?"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirmClick();
            }}
            disabled={!canDelete || submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete {member?.name}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
