// Covers src/lib/clientErrorLogging.ts — the frontend half of app_logs (the edge-function half
// is supabase/functions/_shared/db-log-sink.ts, tested separately under supabase/functions/_shared).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { insertMock, fromMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

async function importFresh() {
  vi.resetModules();
  return import('@/lib/clientErrorLogging');
}

describe('logClientError', () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ error: null });
    fromMock.mockReset().mockReturnValue({ insert: insertMock });
  });
  afterEach(() => vi.restoreAllMocks());

  it('inserts a frontend/error row into app_logs with the given fn/message/context', async () => {
    const { logClientError } = await importFresh();
    logClientError('ErrorBoundary', 'boom', { componentStack: 'at Foo' });

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalled());
    expect(fromMock).toHaveBeenCalledWith('app_logs');
    expect(insertMock).toHaveBeenCalledWith({
      source: 'frontend',
      level: 'error',
      fn: 'ErrorBoundary',
      message: 'boom',
      context: { componentStack: 'at Foo' },
    });
  });

  it('never throws even if the client itself throws synchronously', async () => {
    fromMock.mockImplementation(() => { throw new Error('client not ready'); });
    const { logClientError } = await importFresh();
    expect(() => logClientError('window.onerror', 'boom')).not.toThrow();
  });

  it('warns to console (not app_logs) if the insert itself fails, without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertMock.mockResolvedValue({ error: { message: 'RLS denied' } });
    const { logClientError } = await importFresh();

    logClientError('ErrorBoundary', 'boom');
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0].join(' ')).toContain('RLS denied');
  });
});

describe('installGlobalErrorLogging', () => {
  // installGlobalErrorLogging() is documented "call exactly once, before the app mounts" — it
  // never removes what it adds, by design (production only ever calls it once from main.tsx).
  // But each test here calls it again on the same jsdom `window`, which persists across tests in
  // this file — with no cleanup, a prior test's listener stays attached and fires (using the same
  // shared insertMock/fromMock, since vi.resetModules() only clears the module cache, not these
  // vi.hoisted mocks) when a LATER test dispatches an unrelated event, corrupting that test's
  // assertions on which `fn` got logged. Track and remove exactly the listeners each test adds.
  let addedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

  async function installFresh() {
    const { installGlobalErrorLogging } = await importFresh();
    const originalAdd = window.addEventListener.bind(window);
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      addedListeners.push([type as string, listener as EventListenerOrEventListenerObject]);
      originalAdd(type, listener, options as AddEventListenerOptions | boolean | undefined);
    });
    installGlobalErrorLogging();
    addSpy.mockRestore();
  }

  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ error: null });
    fromMock.mockReset().mockReturnValue({ insert: insertMock });
    addedListeners = [];
  });
  afterEach(() => {
    for (const [type, listener] of addedListeners) window.removeEventListener(type, listener as EventListener);
    vi.restoreAllMocks();
  });

  it('logs an uncaught window error event as fn "window.onerror"', async () => {
    await installFresh();

    window.dispatchEvent(new ErrorEvent('error', { message: 'uncaught boom', filename: 'app.js', lineno: 12, colno: 3 }));

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalled());
    const row = insertMock.mock.calls[0][0];
    expect(row.fn).toBe('window.onerror');
    expect(row.message).toBe('uncaught boom');
  });

  it('logs an unhandled promise rejection as fn "unhandledrejection"', async () => {
    await installFresh();

    // jsdom doesn't implement PromiseRejectionEvent — build a plain Event with the same
    // `reason`/`promise` shape the real browser event carries; the handler only reads `.reason`.
    const event = new Event('unhandledrejection') as unknown as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('rejected boom') });
    Object.defineProperty(event, 'promise', { value: Promise.resolve() });
    window.dispatchEvent(event);

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalled());
    const row = insertMock.mock.calls[0][0];
    expect(row.fn).toBe('unhandledrejection');
    expect(row.context.message).toBe('rejected boom');
  });
});
