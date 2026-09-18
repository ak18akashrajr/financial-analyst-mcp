-- Audit trail for deleting a family member (src/hooks/useFamilyMembers.ts's deleteMember).
-- Deleting a member used to be a single unconfirmed click with no record of why — this backs a
-- GitHub-style "type the name to confirm + give a reason" flow (src/pages/FamilyMembers.tsx) and
-- a visible deletion history on the same page.
--
-- No auth.uid()/user_id partitioning, same as every other table here (see docs/auth-rls-plan.md
-- and 20260917100000_add_family_members.sql) — this is still a single-login app. There's no
-- concept of a distinct "acting user" beyond the one Supabase Auth account (family_member_id is
-- just which portfolio VIEW is selected, not an identity), so deleted_by is free text the person
-- at the keyboard enters at delete time, not a foreign key to any user/identity table.
--
-- member_id is NOT a foreign key to family_members — the whole point is that this row must
-- survive the member it describes being deleted, so member_name/member_relationship are a
-- point-in-time snapshot taken immediately before the delete.
CREATE TABLE public.family_member_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  member_name text NOT NULL,
  member_relationship text NOT NULL,
  reason text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_member_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users only on family_member_deletions" ON public.family_member_deletions
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX family_member_deletions_deleted_at_idx ON public.family_member_deletions (deleted_at DESC);
