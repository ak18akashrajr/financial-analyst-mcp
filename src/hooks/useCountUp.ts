import { useEffect, useRef, useState } from 'react';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Whether we can (and should) animate numbers: needs matchMedia to read the reduce-motion setting.
 * If it's unavailable (jsdom, very old browsers) we can't tell, so we err toward no animation — the
 * number simply shows its real value immediately.
 */
function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface CountUpOptions {
  /** Duration of the first count from 0 (ms). */
  initialDuration?: number;
  /** Duration when the target later changes, e.g. after a price refresh (ms). */
  updateDuration?: number;
}

/**
 * Eases a displayed number toward `target`: counts up from 0 the first time, then glides from
 * whatever is currently shown whenever `target` changes. Returns the target unchanged when
 * animation isn't possible/allowed (see canAnimate), or when the target isn't a finite number.
 */
export function useCountUp(target: number, { initialDuration = 800, updateDuration = 450 }: CountUpOptions = {}): number {
  const animate = canAnimate();
  const [display, setDisplay] = useState(() => (animate && Number.isFinite(target) ? 0 : target));
  const shown = useRef(display);
  const first = useRef(true);

  useEffect(() => {
    const isFirst = first.current;

    if (!canAnimate() || !Number.isFinite(target)) {
      first.current = false;
      shown.current = target;
      setDisplay(target);
      return;
    }

    const from = shown.current;
    if (from === target) return;

    const duration = isFirst ? initialDuration : updateDuration;
    const startedAt = performance.now();
    let raf = 0;

    const step = () => {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      const value = progress >= 1 ? target : from + (target - from) * easeOutCubic(progress);
      shown.current = value;
      setDisplay(value);
      if (progress < 1) raf = requestAnimationFrame(step);
      // Only now is the opening count-up "used up" — flipping it earlier would let a StrictMode
      // double-invoke of this effect (which cancels the first run) shorten the opening animation.
      else first.current = false;
    };
    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [target, initialDuration, updateDuration]);

  return display;
}
