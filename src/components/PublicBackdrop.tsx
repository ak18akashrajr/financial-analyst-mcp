import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const GRID = {
  backgroundImage:
    'linear-gradient(to right, hsl(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.6) 1px, transparent 1px)',
  backgroundSize: '44px 44px',
  // Fade the grid out towards the edges so it reads as a soft glow, not a pattern.
  maskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, black 20%, transparent 75%)',
  WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, black 20%, transparent 75%)',
} as const;

const GLOW = {
  backgroundImage: 'radial-gradient(ellipse 45% 35% at 50% 40%, hsl(var(--chart-blue) / 0.10), transparent 70%)',
} as const;

/**
 * Full-screen shell for the signed-out screens (landing, login, 404): the usual centred column on
 * top of a faint fading grid and a soft blue glow, so they feel like part of the same product as
 * the dashboard rather than three blank white pages. Decorative layers are aria-hidden and sit
 * behind the content.
 */
export function PublicBackdrop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4', className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={GRID} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={GLOW} />
      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </div>
  );
}
