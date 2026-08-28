// Structured JSON logging for edge functions.
//
// Plain `console.log`/`console.error` calls scattered across functions are
// hard to query once they land in Supabase's log explorer — you end up
// grepping free text. Every call here instead emits a single JSON line with
// a consistent shape (timestamp, level, function name, message, context), so
// failures can be filtered by `fn`/`level` and Error objects always carry
// their message + stack instead of collapsing to "[object Object]".
//
// No Deno-specific APIs are used here on purpose, so this file (and its
// tests) run the same under Vitest/Node as they do under the Deno edge
// runtime.

export type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

/** A warn/error entry handed to an attached sink — see `Logger.attachSink`. */
export interface SinkableLogEntry {
  ts: string;
  level: "warn" | "error";
  fn: string;
  message: string;
  context: Record<string, unknown>;
}

/** Receives every warn/error entry a logger emits, in addition to the usual
 * console output. Must never throw — a sink failing is a logging-infra
 * problem, not something that should break the call site being logged. */
export type LogSink = (entry: SinkableLogEntry) => void;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function serializeError(err: Error): SerializedError {
  return { name: err.name, message: err.message, stack: err.stack };
}

function serializeContext(context?: LogContext): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = isError(value) ? serializeError(value) : value;
  }
  return out;
}

const WRITE_BY_LEVEL: Record<LogLevel, (line: string) => void> = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /**
   * Wraps an async operation with start/success/failure logging and a
   * duration in milliseconds, then rethrows on failure so callers keep
   * their own error handling unchanged.
   */
  timed<T>(label: string, operation: () => Promise<T>): Promise<T>;
  /**
   * Wires a fire-and-forget sink that receives every subsequent warn/error
   * entry (info is intentionally excluded — see the app_logs migration).
   * Optional and additive: console output happens exactly as before whether
   * or not a sink is attached. Loggers are created at module load (before
   * any request, before `Deno.env` access is meaningful), so this exists to
   * be called later, once per request, from inside a handler that already
   * has a service-role Supabase client — see _shared/db-log-sink.ts. Pass
   * `undefined` to detach.
   */
  attachSink(sink: LogSink | undefined): void;
}

export function createLogger(fn: string): Logger {
  let sink: LogSink | undefined;

  function write(level: LogLevel, message: string, context?: LogContext): void {
    const serializedContext = serializeContext(context);
    const entry = {
      ts: new Date().toISOString(),
      level,
      fn,
      msg: message,
      ...serializedContext,
    };
    WRITE_BY_LEVEL[level](JSON.stringify(entry));

    if (sink && level !== "info") {
      try {
        sink({ ts: entry.ts, level, fn, message, context: serializedContext });
      } catch {
        // A sink must never take down the call site it's logging for.
      }
    }
  }

  return {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    attachSink: (s) => { sink = s; },
    async timed<T>(label: string, operation: () => Promise<T>): Promise<T> {
      const startedAt = Date.now();
      write("info", `${label} started`);
      try {
        const result = await operation();
        write("info", `${label} completed`, { duration_ms: Date.now() - startedAt });
        return result;
      } catch (err) {
        write("error", `${label} failed`, { duration_ms: Date.now() - startedAt, error: err });
        throw err;
      }
    },
  };
}
