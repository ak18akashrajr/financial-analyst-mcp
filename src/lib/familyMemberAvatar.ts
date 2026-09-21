// Deterministic, Notion-style avatar derived from a person's name — no avatar_url column or
// upload flow needed since the same name always renders the same initials/color.
const PALETTE = [
  'bg-rose-500/15 text-rose-500',
  'bg-amber-500/15 text-amber-500',
  'bg-emerald-500/15 text-emerald-500',
  'bg-sky-500/15 text-sky-500',
  'bg-violet-500/15 text-violet-500',
  'bg-fuchsia-500/15 text-fuchsia-500',
  'bg-orange-500/15 text-orange-500',
  'bg-teal-500/15 text-teal-500',
] as const;

export interface MemberAvatar {
  initials: string;
  colorClass: string;
}

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getMemberAvatar(name: string): MemberAvatar {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');

  return {
    initials: initials.toUpperCase() || '?',
    colorClass: PALETTE[hashName(name) % PALETTE.length],
  };
}
