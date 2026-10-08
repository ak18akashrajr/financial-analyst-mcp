/**
 * Whether we can (and should) run JS-driven animations: needs matchMedia to read the reduce-motion
 * setting. If it's unavailable (jsdom, very old browsers) we can't tell, so we err toward no
 * animation — content simply shows in its final state immediately.
 */
export function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
