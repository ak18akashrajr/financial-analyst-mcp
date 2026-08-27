// Covers src/components/ErrorBoundary.tsx — the render-crash catcher wrapped around the whole
// app in App.tsx. Mirrors the mocking pattern in protected-route.test.tsx.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const { insertMock, fromMock } = vi.hoisted(() => ({
  insertMock: vi.fn().mockResolvedValue({ error: null }),
  fromMock: vi.fn(),
}));
fromMock.mockReturnValue({ insert: insertMock });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

function Bomb(): never {
  throw new Error('render boom');
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders a fallback UI instead of crashing the whole page when a child throws', () => {
    // React logs the caught error to console.error too; silence it for a clean test run.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('logs the caught error into app_logs as source frontend / fn ErrorBoundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    insertMock.mockClear();
    fromMock.mockClear();

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalled());
    expect(fromMock).toHaveBeenCalledWith('app_logs');
    const row = insertMock.mock.calls[0][0];
    expect(row.source).toBe('frontend');
    expect(row.fn).toBe('ErrorBoundary');
    expect(row.message).toBe('render boom');
  });
});
