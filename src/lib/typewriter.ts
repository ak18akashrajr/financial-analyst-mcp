import { canAnimate } from '@/lib/motion';

// The whole answer reaches the browser within milliseconds (portfolio-ai generates it in full,
// runs the output guardrail, and only then emits it — see supabase/functions/portfolio-ai/index.ts),
// so without pacing it just pops in. The typewriter reveals text that has ALREADY been approved
// server-side at a readable speed; it never shows anything the server hasn't released.
const TARGET_SECONDS = 1.4; // aim to have the backlog shown in about this long...
const MIN_CPS = 80; // ...but never slower than this (short answers still read as typed)...
const MAX_CPS = 1500; // ...nor faster than this (a long answer finishes in a couple of seconds).
const MAX_FRAME_SECONDS = 0.1; // a backgrounded tab's huge frame gap shouldn't reveal everything at once

/**
 * Where the visible text may end, given a raw reveal position: a table block is revealed whole
 * (half a markdown table renders as stray pipe characters, then reflows), and otherwise the cut
 * snaps forward to the end of the current word so we never show half a token.
 */
export function revealBoundary(text: string, pos: number): number {
  if (pos >= text.length) return text.length;

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  if (text[lineStart] === '|') {
    let end = lineStart;
    while (end < text.length && text[end] === '|') {
      const nl = text.indexOf('\n', end);
      if (nl === -1) return text.length;
      end = nl + 1;
    }
    return end;
  }

  const rest = text.slice(pos).search(/\s/);
  return rest === -1 ? text.length : pos + rest;
}

export interface Typewriter {
  /** Add newly arrived (already approved) text to the reveal queue. */
  push(text: string): void;
  /** Resolves once everything pushed so far is fully visible. */
  drained(): Promise<void>;
  /** Show everything pushed so far right now. */
  finishNow(): void;
  /** Stop without revealing anything more (e.g. the provider unmounted). */
  cancel(): void;
}

export function createTypewriter(onText: (visible: string) => void, enabled: boolean = canAnimate()): Typewriter {
  let target = '';
  let shown = 0;
  let raf = 0;
  let last = 0;
  let carry = 0;
  let waiters: Array<() => void> = [];

  const settle = () => {
    const ready = waiters;
    waiters = [];
    ready.forEach((resolve) => resolve());
  };

  const showAll = () => {
    shown = target.length;
    onText(target);
    settle();
  };

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    const rate = Math.min(MAX_CPS, Math.max(MIN_CPS, (target.length - shown) / TARGET_SECONDS));
    carry += rate * dt;
    const step = Math.floor(carry);
    if (step > 0) {
      carry -= step;
      shown = revealBoundary(target, shown + step);
      onText(target.slice(0, shown));
    }
    if (shown >= target.length) {
      raf = 0;
      settle();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    push(text) {
      target += text;
      if (!enabled) {
        showAll();
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    drained() {
      return shown >= target.length ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve));
    },
    finishNow() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (shown < target.length) showAll();
      else settle();
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      settle();
    },
  };
}
