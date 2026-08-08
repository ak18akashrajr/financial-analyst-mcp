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
}

export function createLogger(fn: string): Logger {
  function write(level: LogLevel, message: string, context?: LogContext): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      fn,
      msg: message,
      ...serializeContext(context),
    };
    WRITE_BY_LEVEL[level](JSON.stringify(entry));
  }

  return {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
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
