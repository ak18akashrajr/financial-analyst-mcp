import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FadeInProps {
  /** Position in the entrance sequence; each step adds a small delay so sections cascade in. */
  index?: number;
  className?: string;
  children: ReactNode;
}

const STEP_MS = 60;
const MAX_STEPS = 8;

/**
 * Fade + rise entrance with a per-index delay, for staggering a page's sections as they appear.
 * fill-mode-backwards keeps a delayed section invisible until its turn. `empty:hidden` drops the
 * wrapper when its child renders nothing, so it can't add a stray gap in a `space-y-*` stack.
 * (The global prefers-reduced-motion rule in index.css collapses the animation for those users.)
 */
export function FadeIn({ index = 0, className, children }: FadeInProps) {
  return (
    <div
      className={cn('animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-backwards empty:hidden', className)}
      style={{ animationDelay: `${Math.min(index, MAX_STEPS) * STEP_MS}ms` }}
    >
      {children}
    </div>
  );
}
