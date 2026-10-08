import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useCountUp } from '@/hooks/useCountUp';

const fmt = (n: number) => `₹${Math.round(n)}`;

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('useCountUp / AnimatedNumber', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it('shows the real value immediately when matchMedia is unavailable (cannot read motion preference)', () => {
    window.matchMedia = undefined as never;
    const { result } = renderHook(() => useCountUp(1000));
    expect(result.current).toBe(1000);
  });

  it('shows the real value immediately under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useCountUp(1000));
    expect(result.current).toBe(1000);
  });

  it('counts up from 0 to the target on first show, then settles exactly on the target', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useCountUp(1000, { initialDuration: 800 }));
    expect(result.current).toBe(0);
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(1000);
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current).toBe(1000);
  });

  it('glides from the current value (not from 0) when the target changes', () => {
    mockMatchMedia(false);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { initialDuration: 100, updateDuration: 400 }), {
      initialProps: { v: 1000 },
    });
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBe(1000);

    rerender({ v: 2000 });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBeGreaterThan(1000);
    expect(result.current).toBeLessThan(2000);
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current).toBe(2000);
  });

  it('passes a non-finite target straight through', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useCountUp(Number.NaN));
    expect(result.current).toBeNaN();
  });

  it('AnimatedNumber flashes green on increase and red on decrease, then clears', () => {
    window.matchMedia = undefined as never; // no count-up: isolate the flash behaviour
    const { rerender } = render(<AnimatedNumber value={100} format={fmt} flash />);
    const el = () => screen.getByText(/₹/);
    expect(el()).not.toHaveClass('text-gain');

    rerender(<AnimatedNumber value={150} format={fmt} flash />);
    expect(el()).toHaveClass('text-gain');
    act(() => void vi.advanceTimersByTime(1300));
    expect(el()).not.toHaveClass('text-gain');

    rerender(<AnimatedNumber value={120} format={fmt} flash />);
    expect(el()).toHaveClass('text-loss');
  });

  it('does not flash unless asked to', () => {
    window.matchMedia = undefined as never;
    const { rerender } = render(<AnimatedNumber value={100} format={fmt} />);
    rerender(<AnimatedNumber value={150} format={fmt} />);
    expect(screen.getByText('₹150')).not.toHaveClass('text-gain');
  });
});
