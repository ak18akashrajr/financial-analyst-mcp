// Covers src/pages/DevZone.tsx — the "one stop solution to view all logs" page. Follows the
// repo convention of mocking @/integrations/supabase/client directly rather than a real backend
// (see src/test/benchmark-page.test.tsx for the pattern this extends).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DevZone from '@/pages/DevZone';

const { appLogRows, auditLogRows } = vi.hoisted(() => ({
  appLogRows: [] as Record<string, unknown>[],
  auditLogRows: [] as Record<string, unknown>[],
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
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

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
  });

  it('shows an empty state on the App Logs tab when nothing has been logged', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no warnings or errors logged yet/i)).toBeInTheDocument());
  });

  it('lists app_logs rows with level, source, fn and message', async () => {
    appLogRows.push({
      id: '1', logged_at: '2026-08-27T10:00:00Z', source: 'edge', level: 'error',
      fn: 'fetch-prices', message: 'Failed to fetch price', context: { symbol: 'TCS' },
    });
    renderPage();

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
    await waitFor(() => expect(screen.getByText(/no warnings or errors logged yet/i)).toBeInTheDocument());

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
});
