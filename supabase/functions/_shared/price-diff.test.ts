import { describe, expect, it } from "vitest";
import { PRICE_CHANGE_EPSILON, selectPricesToWrite } from "./price-diff.ts";

describe("selectPricesToWrite", () => {
  it("writes every symbol on its first fetch, since nothing exists yet", () => {
    const { toWrite, changed, unchanged } = selectPricesToWrite({ TCS: 3500, INFY: 1500 }, {});
    expect(toWrite).toEqual({ TCS: 3500, INFY: 1500 });
    expect(changed).toEqual(["TCS", "INFY"]);
    expect(unchanged).toEqual([]);
  });

  it("skips a symbol whose price is unchanged", () => {
    const { toWrite, changed, unchanged } = selectPricesToWrite({ TCS: 3500 }, { TCS: 3500 });
    expect(toWrite).toEqual({});
    expect(changed).toEqual([]);
    expect(unchanged).toEqual(["TCS"]);
  });

  it("writes a symbol whose price genuinely moved", () => {
    const { toWrite, changed, unchanged } = selectPricesToWrite({ TCS: 3510 }, { TCS: 3500 });
    expect(toWrite).toEqual({ TCS: 3510 });
    expect(changed).toEqual(["TCS"]);
    expect(unchanged).toEqual([]);
  });

  it("treats a sub-epsilon difference as float noise, not a real move", () => {
    const { toWrite, changed, unchanged } = selectPricesToWrite(
      { TCS: 3500 + PRICE_CHANGE_EPSILON / 2 },
      { TCS: 3500 },
    );
    expect(toWrite).toEqual({});
    expect(changed).toEqual([]);
    expect(unchanged).toEqual(["TCS"]);
  });

  it("writes a difference right at the epsilon boundary", () => {
    const { changed } = selectPricesToWrite({ TCS: 3500 + PRICE_CHANGE_EPSILON + 0.001 }, { TCS: 3500 });
    expect(changed).toEqual(["TCS"]);
  });

  it("handles a mixed batch: new, changed, and unchanged symbols together", () => {
    const { toWrite, changed, unchanged } = selectPricesToWrite(
      { TCS: 3500, INFY: 1510, RELIANCE: 2900 },
      { TCS: 3500, INFY: 1500 },
    );
    expect(toWrite).toEqual({ INFY: 1510, RELIANCE: 2900 });
    expect(changed.sort()).toEqual(["INFY", "RELIANCE"]);
    expect(unchanged).toEqual(["TCS"]);
  });

  it("returns empty results for an empty fetch", () => {
    expect(selectPricesToWrite({}, { TCS: 3500 })).toEqual({ toWrite: {}, changed: [], unchanged: [] });
  });
});
