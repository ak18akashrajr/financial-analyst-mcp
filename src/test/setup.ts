import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { resetHidden } from "../lib/privacyStore";

// The hide-numbers flag is now module-level, session-persisted state; reset it so one test toggling it
// can never leak into the next.
afterEach(() => resetHidden());

// jsdom has no layout engine, so recharts' <ResponsiveContainer> (used by treemap/line/area
// charts) can't measure its host element. Stub ResizeObserver and give every element a
// non-zero bounding box so those charts get real dimensions to lay out against in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver);

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  writable: true,
  configurable: true,
  value: () => ({
    width: 400,
    height: 280,
    top: 0,
    left: 0,
    bottom: 280,
    right: 400,
    x: 0,
    y: 0,
    toJSON: () => {},
  }),
});

// jsdom's AbortSignal polyfill lacks the static `.timeout()` method (added to
// the real DOM/Node/Deno spec well before jsdom picked it up) — used by
// _shared/providers/openrouter.ts to bound a hung upstream request. Deno
// (this app's actual edge runtime) has supported it for a long time; this is
// a test-environment gap only, not a production concern.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
    return controller.signal;
  };
}

// Tests behave like a reduce-motion user: number count-ups (useCountUp) are skipped so assertions see
// final values synchronously. Animation tests override window.matchMedia themselves.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
