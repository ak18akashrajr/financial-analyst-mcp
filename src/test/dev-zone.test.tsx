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

const { appLogRows, auditLogRows, probeSymbolRows, securityIncidentRows, invokeMock, signOutMock, updateIncidentMock } = vi.hoisted(() => ({
  appLogRows: [] as Record<string, unknown>[],
  auditLogRows: [] as Record<string, unknown>[],
  probeSymbolRows: [{ symbol: 'RELIANCE.NS' }] as Record<string, unknown>[],
  securityIncidentRows: [] as Record<string, unknown>[],
  invokeMock: vi.fn((_fn: string, _opts?: { body?: unknown }) => Promise.resolve({ data: {} as any, error: null as any })),
  signOutMock: vi.fn(() => Promise.resolve({ error: null as { message: string } | null })),
  updateIncidentMock: vi.fn((_id: string) => Promise.resolve({ error: null as { message: string } | null })),
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
      if (table === 'security_incidents') {
        return {
          // SecurityIncidentsContext's unacknowledged-only fetch (banner, not visible in DevZone itself).
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: securityIncidentRows.filter((r) => !r.acknowledged), error: null }) }),
            order: () => ({ limit: () => Promise.resolve({ data: securityIncidentRows, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              const row = securityIncidentRows.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return updateIncidentMock(id);
            },
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    auth: {
      // System Status tab's Auth check.
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
      signOut: signOutMock,
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
    securityIncidentRows.length = 0;
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve({ data: {}, error: null }));
    signOutMock.mockReset();
    signOutMock.mockImplementation(() => Promise.resolve({ error: null }));
    updateIncidentMock.mockClear();
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

  describe('Security tab', () => {
    it('shows an empty state when there are no incidents', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));
      await waitFor(() => expect(screen.getByText(/no replay incidents detected yet/i)).toBeInTheDocument());
    });

    it('lists an incident with its table, operation, session and IP', async () => {
      securityIncidentRows.push({
        id: '1', detected_at: '2026-08-29T03:32:34Z', session_id: 'b097e56c-5a00-4e1b-9153-60a214ff10b3',
        table_name: 'cash_settings', operation: 'update', row_id: '02d0b63d-f691-44f6-838d-1bb8fdd5e59e',
        old_values: { liquid_cash: 230.84 }, new_values: { liquid_cash: 230.84 },
        ip: '223.181.196.149', user_agent: 'curl/8.21.0', acknowledged: false,
      });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('cash_settings')).toBeInTheDocument());
      expect(screen.getByText('update')).toBeInTheDocument();
      expect(screen.getByText(/223\.181\.196\.149/)).toBeInTheDocument();
      expect(screen.getByText(/b097e56c/)).toBeInTheDocument();
    });

    it('expands a row to show the before/after diff', async () => {
      securityIncidentRows.push({
        id: '1', detected_at: '2026-08-29T03:32:34Z', session_id: 'sess-1', table_name: 'cash_settings',
        operation: 'update', row_id: 'row-1', old_values: { liquid_cash: 100 }, new_values: { liquid_cash: 200 },
        ip: '1.2.3.4', user_agent: 'curl/8.21.0', acknowledged: false,
      });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('cash_settings')).toBeInTheDocument());
      expect(screen.queryByText(/"liquid_cash": 100/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('cash_settings'));
      await waitFor(() => expect(screen.getByText(/"liquid_cash": 100/)).toBeInTheDocument());
      expect(screen.getByText(/"liquid_cash": 200/)).toBeInTheDocument();
    });

    it('defaults to showing only unacknowledged incidents, and switching the filter reveals acknowledged ones', async () => {
      securityIncidentRows.push(
        { id: '1', detected_at: '2026-08-29T03:00:00Z', session_id: 'sess-1', table_name: 'transactions', operation: 'insert', row_id: 'row-1', old_values: null, new_values: {}, ip: '1.1.1.1', user_agent: 'ua', acknowledged: false },
        { id: '2', detected_at: '2026-08-29T02:00:00Z', session_id: 'sess-2', table_name: 'symbol_metadata', operation: 'update', row_id: 'TCS', old_values: {}, new_values: {}, ip: '2.2.2.2', user_agent: 'ua', acknowledged: true },
      );
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('transactions')).toBeInTheDocument());
      expect(screen.queryByText('symbol_metadata')).not.toBeInTheDocument();

      fireEvent.change(screen.getByDisplayValue('Unacknowledged'), { target: { value: 'acknowledged' } });
      await waitFor(() => expect(screen.getByText('symbol_metadata')).toBeInTheDocument());
      expect(screen.queryByText('transactions')).not.toBeInTheDocument();
    });

    it('acknowledges an incident, removing it from the default unacknowledged view', async () => {
      securityIncidentRows.push({
        id: '1', detected_at: '2026-08-29T03:00:00Z', session_id: 'sess-1', table_name: 'transactions',
        operation: 'insert', row_id: 'row-1', old_values: null, new_values: {}, ip: '1.1.1.1', user_agent: 'ua',
        acknowledged: false,
      });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('transactions')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^acknowledge$/i }));

      await waitFor(() => expect(screen.queryByText('transactions')).not.toBeInTheDocument());
      expect(updateIncidentMock).toHaveBeenCalledWith('1');
    });

    it('asks for confirmation before global sign-out, and does nothing if declined', async () => {
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('Global sign-out')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));

      expect(window.confirm).toHaveBeenCalled();
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('calls supabase.auth.signOut with global scope once confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('Global sign-out')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));

      await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: 'global' }));
      await waitFor(() => expect(screen.getByText(/signed out everywhere/i)).toBeInTheDocument());
    });

    it('shows the sign-out error message when it fails', async () => {
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      signOutMock.mockImplementation(() => Promise.resolve({ error: { message: 'network error' } }));
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /security/i }));

      await waitFor(() => expect(screen.getByText('Global sign-out')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));

      await waitFor(() => expect(screen.getByText('network error')).toBeInTheDocument());
    });
  });
});
