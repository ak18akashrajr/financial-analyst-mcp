import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.ts";

function lastEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const line = spy.mock.calls.at(-1)?.[0] as string;
  return JSON.parse(line);
}

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes info/warn/error to the matching console method", () => {
    const logger = createLogger("fetch-prices");
    logger.info("starting");
    logger.warn("degraded");
    logger.error("failed");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("emits a JSON line carrying fn, level, msg, and ts", () => {
    const logger = createLogger("fetch-prices");
    logger.info("starting");

    const entry = lastEntry(logSpy);
    expect(entry.fn).toBe("fetch-prices");
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("starting");
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts as string).toString()).not.toBe("Invalid Date");
  });

  it("merges arbitrary context fields into the entry", () => {
    const logger = createLogger("fetch-fx-rates");
    logger.warn("upsert error", { pair: "USDINR", rows: 12 });

    const entry = lastEntry(warnSpy);
    expect(entry.pair).toBe("USDINR");
    expect(entry.rows).toBe(12);
  });

  it("serializes Error context values into name/message/stack instead of {}", () => {
    const logger = createLogger("fetch-pe-ratio");
    const err = new Error("boom");
    logger.error("fetch failed", { symbol: "TCS", error: err });

    const entry = lastEntry(errorSpy);
    expect(entry.symbol).toBe("TCS");
    expect(entry.error).toMatchObject({ name: "Error", message: "boom" });
    expect((entry.error as { stack?: string }).stack).toContain("boom");
  });

  it("logs start/completion and returns the operation's result on success", async () => {
    const logger = createLogger("fetch-prices");
    const result = await logger.timed("refresh", async () => "ok");

    expect(result).toBe("ok");
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(lastEntry(logSpy).msg).toBe("refresh completed");
    expect(typeof lastEntry(logSpy).duration_ms).toBe("number");
  });

  it("logs failure with duration and rethrows the original error", async () => {
    const logger = createLogger("fetch-prices");
    const err = new Error("upstream down");

    await expect(
      logger.timed("refresh", async () => {
        throw err;
      })
    ).rejects.toThrow("upstream down");

    const entry = lastEntry(errorSpy);
    expect(entry.msg).toBe("refresh failed");
    expect(typeof entry.duration_ms).toBe("number");
    expect(entry.error).toMatchObject({ message: "upstream down" });
  });

  describe("attachSink", () => {
    it("forwards warn and error entries to the attached sink", () => {
      const logger = createLogger("fetch-prices");
      const sink = vi.fn();
      logger.attachSink(sink);

      logger.warn("degraded", { symbol: "TCS" });
      logger.error("failed", { symbol: "INFY" });

      expect(sink).toHaveBeenCalledTimes(2);
      expect(sink).toHaveBeenNthCalledWith(1, expect.objectContaining({
        level: "warn",
        fn: "fetch-prices",
        message: "degraded",
        context: { symbol: "TCS" },
      }));
      expect(sink).toHaveBeenNthCalledWith(2, expect.objectContaining({
        level: "error",
        fn: "fetch-prices",
        message: "failed",
        context: { symbol: "INFY" },
      }));
    });

    it("does not forward info-level entries to the sink", () => {
      const logger = createLogger("fetch-prices");
      const sink = vi.fn();
      logger.attachSink(sink);

      logger.info("starting");

      expect(sink).not.toHaveBeenCalled();
    });

    it("still writes to console when no sink is attached (default, unchanged behavior)", () => {
      const logger = createLogger("fetch-prices");
      logger.warn("degraded");
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("stops forwarding once detached with undefined", () => {
      const logger = createLogger("fetch-prices");
      const sink = vi.fn();
      logger.attachSink(sink);
      logger.attachSink(undefined);

      logger.error("failed");

      expect(sink).not.toHaveBeenCalled();
    });

    it("a throwing sink doesn't break the log call or console output", () => {
      const logger = createLogger("fetch-prices");
      logger.attachSink(() => {
        throw new Error("sink boom");
      });

      expect(() => logger.error("failed")).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
