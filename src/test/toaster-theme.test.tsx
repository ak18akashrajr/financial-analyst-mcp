import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Sonner only mounts its DOM once a toast exists, so assert on the `theme` prop we hand it instead.
vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: ({ theme }: { theme?: string }) => <div data-testid="sonner" data-theme={theme} />,
}));

import { Toaster } from '@/components/ui/sonner';
import { useIsDark } from '@/hooks/useIsDark';

// ThemeToggle flips the `dark` class on <html> directly (no ThemeProvider), so the toaster has to
// follow that class — not next-themes' useTheme(), which always said "system" here.
describe('toaster theme', () => {
  afterEach(() => document.documentElement.classList.remove('dark'));

  it('useIsDark reflects the html class and updates live', async () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.classList.add('dark');
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
    await act(async () => {
      document.documentElement.classList.remove('dark');
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });

  it('renders the toaster in the matching theme', () => {
    document.documentElement.classList.add('dark');
    const { getByTestId } = render(<Toaster />);
    expect(getByTestId('sonner').getAttribute('data-theme')).toBe('dark');
  });
});
