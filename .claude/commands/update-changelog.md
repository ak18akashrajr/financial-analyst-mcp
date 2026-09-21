---
description: Draft new /updates changelog entries from commits since the last entry, for review
---

Draft new entries for the `UPDATES` array in [src/pages/Updates.tsx](src/pages/Updates.tsx) (the
public `/updates` changelog page) covering everything shipped since the most recent entry. This
never auto-publishes — it produces a draft for the user to review, exactly like any other code
change, on its own branch through the normal PR workflow (see CLAUDE.md's repo workflow section).

## Steps

1. Read `UPDATES[0]` (the first/newest entry) in `src/pages/Updates.tsx` and note its `date`.
2. Run `git log --since=<that date> --no-merges --pretty=format:'%ad|%s' --date=short` to collect
   every commit since then. If there are none, say so and stop — nothing to draft.
3. Group the commits into a handful of weekly/thematic entries (not one entry per commit) —
   match the density and voice of the existing entries: outcome-focused bullets a user would
   actually care about, skip commits that are pure chores, internal docs/TODO housekeeping, or
   test-only changes unless they're genuinely user-visible.
4. **Security rule — this page is public with no login required** (per the existing 2026-05-05
   "Changelog page is now publicly accessible" entry). For anything touching
   authentication/session security/prompt-injection/a closed vulnerability: confirm generically
   that it shipped ("hardened authentication and session security") — never name the mechanism,
   the vulnerability, or how it worked.
5. Each new entry follows the existing `Update` shape: `{ date, version?, title, type, items }`
   with `type` one of `feature | fix | improvement | foundation`. Only give a `version` label to
   entries that are genuinely a notable milestone (matches how the existing entries are sparse
   with version numbers, not every entry has one) — continue the numbering from whatever the
   highest existing `version` is.
6. Prepend the new entries to the top of the `UPDATES` array (newest first, same as today).
7. Show the user a summary of what was added (dates + titles) before considering the task done.
   Follow the repo's normal git workflow for this change — a feature branch and PR, never a
   direct commit to `main` (see CLAUDE.md).
