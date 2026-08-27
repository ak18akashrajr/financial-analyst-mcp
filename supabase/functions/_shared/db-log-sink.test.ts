import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbLogSink } from "./db-log-sink.ts";
import type { SinkableLogEntry } from "./logger.ts";

const SAMPLE_ENTRY: SinkableLogEntry = {
  ts: "2026-08-27T10:00:00.000Z",
  level: "error",
  fn: "fetch-prices",
  message: "Failed to fetch price",
  context: { symbol: "TCS" },
};

/** Minimal fake matching just the `.from(table).insert(row)` shape db-log-sink.ts
 * actually calls — not a real SupabaseClient. */
function fakeClient(insertResult: { error: { message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { from, insert };
}

describe("createDbLogSink", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a row into app_logs shaped from the log entry", async () => {
    const { from, insert } = fakeClient({ error: null });
    const sink = createDbLogSink({ from } as never);

    sink(SAMPLE_ENTRY);
    await vi.waitFor(() => expect(insert).toHaveBeenCalled());

    expect(from).toHaveBeenCalledWith("app_logs");
    expect(insert).toHaveBeenCalledWith({
      source: "edge",
      level: "error",
      fn: "fetch-prices",
      message: "Failed to fetch price",
      context: { symbol: "TCS" },
    });
  });

  it("is fire-and-forget — the sink call itself never throws or returns a promise", () => {
    const { from } = fakeClient({ error: null });
    const sink = createDbLogSink({ from } as never);

    expect(() => sink(SAMPLE_ENTRY)).not.toThrow();
  });

  it("logs a plain console.warn (not through the logger) when the insert fails, without throwing", async () => {
    const { from, insert } = fakeClient({ error: { message: "permission denied" } });
    const sink = createDbLogSink({ from } as never);

    sink(SAMPLE_ENTRY);
    await vi.waitFor(() => expect(insert).toHaveBeenCalled());
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(line.fn).toBe("db-log-sink");
    expect(line.error).toBe("permission denied");
  });

  it("swallows a client that throws/rejects entirely (e.g. network failure)", async () => {
    const from = vi.fn().mockReturnValue({
      insert: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const sink = createDbLogSink({ from } as never);

    expect(() => sink(SAMPLE_ENTRY)).not.toThrow();
    // Give the rejected promise's .catch() a tick to run without throwing an
    // unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
