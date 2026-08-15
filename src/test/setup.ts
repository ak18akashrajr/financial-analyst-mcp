import "@testing-library/jest-dom";

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

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
