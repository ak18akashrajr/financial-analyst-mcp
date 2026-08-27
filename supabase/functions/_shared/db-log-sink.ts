// Persists a logger.ts warn/error entry into public.app_logs (see migration
// 20260827130000_add_app_logs.sql). Wired up per-function via
// `logger.attachSink(createDbLogSink(supabase))` — see logger.ts's
// `attachSink` doc comment for why this is a separate opt-in step rather
// than something logger.ts does unconditionally itself.
//
// Deliberately best-effort and fire-and-forget, same posture as
// _shared/audit-log.ts: a logging call must never be slowed down by or
// fail because of a DB write, and a sink is explicitly documented (see
// logger.ts) as never allowed to throw back into the log call site.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { LogSink, SinkableLogEntry } from "./logger.ts";

export function createDbLogSink(sb: SupabaseClient): LogSink {
  return (entry: SinkableLogEntry) => {
    void sb
      .from("app_logs")
      .insert({
        source: "edge",
        level: entry.level,
        fn: entry.fn,
        message: entry.message,
        context: entry.context,
      })
      .then(({ error }) => {
        if (error) {
          // Plain console.warn, not the logger — routing a sink's own
          // failure back through the logger (and thus back through every
          // attached sink) risks a loop.
          console.warn(JSON.stringify({
            ts: new Date().toISOString(),
            level: "warn",
            fn: "db-log-sink",
            msg: "Failed to persist app_logs row",
            error: error.message,
          }));
        }
      })
      .catch(() => {
        // Network/client-construction failure — same best-effort posture.
      });
  };
}
