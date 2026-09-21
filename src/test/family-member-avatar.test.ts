// getMemberAvatar is a pure name -> {initials, colorClass} function backing the "Who's Watching"
// picker and the header switch-profile button — no avatar_url column, so this is the only place
// an avatar is derived.
import { describe, expect, it } from 'vitest';
import { getMemberAvatar } from '@/lib/familyMemberAvatar';

describe('getMemberAvatar', () => {
  it('uses the first letter of up to two words as initials', () => {
    expect(getMemberAvatar('Rethinasamy').initials).toBe('R');
    expect(getMemberAvatar('Fam').initials).toBe('F');
  });

  it('is deterministic — the same name always gets the same avatar', () => {
    const first = getMemberAvatar('Balaji');
    const second = getMemberAvatar('Balaji');
    expect(second).toEqual(first);
  });

  it('gives different names different colors most of the time', () => {
    const names = ['Self', 'Rethinasamy', 'Egavalli', 'Balaji'];
    const colors = new Set(names.map((n) => getMemberAvatar(n).colorClass));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('falls back to "?" for an empty name', () => {
    expect(getMemberAvatar('').initials).toBe('?');
  });
});
