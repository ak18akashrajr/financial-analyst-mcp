// Frontend half of the app_logs table (see supabase/migrations/20260827130000_add_app_logs.sql
// and supabase/functions/_shared/db-log-sink.ts for the edge-function half). Nothing existed here
// before — no error boundary, no window.onerror capture — so this file covers exactly the two
// failure modes global handlers can catch: a React render-phase crash (via ErrorBoundary.tsx) and
// an uncaught JS error / unhandled promise rejection anywhere else (via installGlobalErrorLogging,
// called once from main.tsx). Deliberately NOT a general-purpose logger callable from arbitrary
// components — see the "Wire up a Dev Zone logs page" scoping conversation for why that was
// explicitly out of scope for this pass.
import { supabase } from '@/integrations/supabase/client';

/** Best-effort persist of a frontend crash into public.app_logs. Never throws — a logging
 * failure must never compound the error it's trying to record. Silently a no-op before login
 * (the table's RLS policy requires an authenticated session, same as the rest of this
 * single-user app) — there's nothing to review from a pre-auth crash today anyway. */
export function logClientError(fn: string, message: string, context: Record<string, unknown> = {}): void {
  try {
    void supabase
      .from('app_logs')
      .insert({ source: 'frontend', level: 'error', fn, message, context: context as never })
      .then(({ error }) => {
        if (error) console.warn('[app_logs] failed to persist frontend log row:', error.message);
      });
  } catch {
    // best-effort — see file header.
  }
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { value: String(err) };
}

/** Registers window-level handlers for uncaught errors and unhandled promise rejections — the
 * two failure modes a React error boundary can't see (it only catches render-phase errors in
 * its own subtree). Call exactly once, before the app mounts. */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    logClientError('window.onerror', event.message || 'Uncaught error', {
      ...serializeError(event.error),
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logClientError('unhandledrejection', 'Unhandled promise rejection', serializeError(event.reason));
  });
}
