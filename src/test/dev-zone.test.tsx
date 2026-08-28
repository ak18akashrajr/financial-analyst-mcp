// Covers src/pages/DevZone.tsx — the "one stop solution to view all logs" page. Follows the
// repo convention of mocking @/integrations/supabase/client directly rather than a real backend
// (see src/test/benchmark-page.test.tsx for the pattern this extends).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';

// DevZone.tsx reads import.meta.env.VITE_SUPABASE_URL at module scope (for the
// System Status tab's edge-function pings) — unset in CI, where no .env exists
// (same gap noted in portfolio-ai-preset-questions.test.ts). A static import
// evaluates that module-scope read before vi.stubEnv below ever runs (import
// statements are hoisted ahead of the rest of this file's body), so DevZone
// has to be loaded dynamically, after the stub is in place.
vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');

let DevZone: ComponentType;

beforeAll(async () => {
  ({ default: DevZone } = await import('@/pages/DevZone'));
});

const { appLogRows, auditLogRows, probeSymbolRows, invokeMock } = vi.hoisted(() => ({
  appLogRows: [] as Record<string, unknown>[],
  auditLogRows: [] as Record<string, unknown>[],
  probeSymbolRows: [{ symbol: 'RELIANCE.NS' }] as Record<string, unknown>[],
  invokeMock: vi.fn((_fn: string, _opts?: { body?: unknown }) => Promise.resolve({ data: {} as any, error: null as any })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'app_logs') {
        return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: appLogRows, error: null }) }) }) };
      }
      if (table === 'audit_logs') {
        return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: auditLogRows, error: null }) }) }) };
      }
      if (table === 'cash_settings') {
        // System Status tab's DB check — a lightweight head-only query.
        return { select: () => Promise.resolve({ error: null }) };
      }
      if (table === 'transactions') {
        // Deep checks' probe-symbol lookup.
        return { select: () => ({ limit: () => Promise.resolve({ data: probeSymbolRows, error: null }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    auth: {
      // System Status tab's Auth check.
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
    functions: {
      // Deep checks' fetch-prices/fetch-fx-rates/etc calls.
      invoke: invokeMock,
    },
  },
}));

// System Status tab pings every edge function with a raw, deliberately
// unauthenticated POST and treats a 401 back as "reachable" (see
// pingEdgeFunction's comment in DevZone.tsx) — stub fetch to return that by
// default so tests that don't care about Status (App Logs / Audit Trail)
// don't hit the network, and Status tests default to all-healthy.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))));
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DevZone />
    </MemoryRouter>,
  );
}

describe('DevZone', () => {
  beforeEach(() => {
    appLogRows.length = 0;
    auditLogRows.length = 0;
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve({ data: {}, error: null }));
  });

  it('shows an empty state on the App Logs tab when nothing has been logged', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'App Logs' }));
    await waitFor(() => expect(screen.getByText(/no warnings or errors logged yet/i)).toBeInTheDocument());
  });

  it('lists app_logs rows with level, source, fn and message', async () => {
    appLogRows.push({
      id: '1', logged_at: '2026-08-27T10:00:00Z', source: 'edge', level: 'error',
      fn: 'fetch-prices', message: 'Failed to fetch price', context: { symbol: 'TCS' },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'App Logs' }));

    await waitFor(() => expect(screen.getByText('Failed to fetch price')).toBeInTheDocument());
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('edge')).toBeInTheDocument();
    expect(screen.getByText('fetch-prices')).toBeInTheDocument();
  });

  it('expands a row to show its raw JSON context on click', async () => {
    appLogRows.push({
      id: '1', logged_at: '2026-08-27T10:00:00Z', source: 'edge', level: 'warn',
      fn: 'fetch-fx-rates', message: 'upsert error', context: { pair: 'USDINR' },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'App Logs' }));

    await waitFor(() => expect(screen.getByText('upsert error')).toBeInTheDocument());
    expect(screen.queryByText(/"pair"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('upsert error'));
    await waitFor(() => expect(screen.getByText(/"pair"/)).toBeInTheDocument());
  });

  it('filters app_logs by level', async () => {
    appLogRows.push(
      { id: '1', logged_at: '2026-08-27T10:00:00Z', source: 'edge', level: 'error', fn: 'fetch-prices', message: 'error message', context: {} },
      { id: '2', logged_at: '2026-08-27T10:01:00Z', source: 'edge', level: 'warn', fn: 'fetch-prices', message: 'warn message', context: {} },
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'App Logs' }));

    await waitFor(() => expect(screen.getByText('error message')).toBeInTheDocument());
    expect(screen.getByText('warn message')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All levels'), { target: { value: 'error' } });

    expect(screen.getByText('error message')).toBeInTheDocument();
    expect(screen.queryByText('warn message')).not.toBeInTheDocument();
  });

  it('switches to the Audit Trail tab and lists MCP tool calls', async () => {
    auditLogRows.push({
      id: '1', called_at: '2026-08-27T10:00:00Z', actor: null, tool_name: 'get_portfolio_summary',
      arguments: {}, duration_ms: 42, success: true, error: null,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Audit Trail' }));

    await waitFor(() => expect(screen.getByText('get_portfolio_summary')).toBeInTheDocument());
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();
  });

  it('shows the failure reason inline for a failed tool call', async () => {
    auditLogRows.push({
      id: '1', called_at: '2026-08-27T10:00:00Z', actor: null, tool_name: 'run_stress_test',
      arguments: { pct: 20 }, duration_ms: 10, success: false, error: 'timeout',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Audit Trail' }));

    await waitFor(() => expect(screen.getByText('run_stress_test')).toBeInTheDocument());
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  describe('System Status tab (default view)', () => {
    it('reports all systems operational when DB, Auth and every edge function respond OK', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());

      expect(screen.getByText('Database (Postgres via PostgREST)')).toBeInTheDocument();
      expect(screen.getByText('Auth (GoTrue)')).toBeInTheDocument();
      expect(screen.getByText('Portfolio MCP Server')).toBeInTheDocument();
    });

    it('flags a failing check when the database query errors', async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      vi.spyOn(supabase, 'from').mockImplementationOnce(() => ({
        select: () => Promise.resolve({ error: { message: 'connection refused' } }),
      }) as never);

      renderPage();
      await waitFor(() => expect(screen.getByText(/check.*failing/i)).toBeInTheDocument());
      expect(screen.getByText('connection refused')).toBeInTheDocument();
    });

    it('flags an edge function as failing when its reachability ping returns an unexpected status', async () => {
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.includes('fetch-fx-rates')) return Promise.resolve(new Response(null, { status: 503 }));
        return Promise.resolve(new Response(null, { status: 401 }));
      }));

      renderPage();
      await waitFor(() => expect(screen.getByText(/check.*failing/i)).toBeInTheDocument());
      expect(screen.getByText('Unexpected HTTP 503')).toBeInTheDocument();
    });

    it('sends the anon apikey header on the reachability ping', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })));
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/fetch-prices'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: 'test-anon-key' },
          body: '{}',
        }),
      );
    });

    it('re-runs all checks when Recheck is clicked', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /recheck/i }));
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());
    });

    it('does not call any edge function beyond the reachability ping until Run Deep Checks is clicked', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('runs deep checks against a real portfolio symbol and shows a live price', async () => {
      invokeMock.mockImplementation((fn: string) =>
        fn === 'fetch-prices'
          ? Promise.resolve({ data: { prices: { 'RELIANCE.NS': 2456.7 } }, error: null })
          : Promise.resolve({ data: {}, error: null }),
      );

      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /run deep checks/i }));

      await waitFor(() => expect(screen.getByText(/Deep: Live price for RELIANCE\.NS: 2456\.7/)).toBeInTheDocument());
      expect(invokeMock).toHaveBeenCalledWith('fetch-prices', { body: { symbols: ['RELIANCE.NS'] } });
    });

    it('shows a deep-check failure when an edge function errors', async () => {
      invokeMock.mockImplementation((fn: string) =>
        fn === 'fetch-fx-rates'
          ? Promise.resolve({ data: null, error: { message: 'Yahoo Finance unreachable' } })
          : Promise.resolve({ data: {}, error: null }),
      );

      renderPage();
      await waitFor(() => expect(screen.getByText('All systems operational')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /run deep checks/i }));

      await waitFor(() => expect(screen.getByText(/Deep: Yahoo Finance unreachable/)).toBeInTheDocument());
    });
  });
});
