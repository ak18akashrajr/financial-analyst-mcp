import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { getHidden, resetHidden, setHidden, toggleHidden } from '@/lib/privacyStore';

describe('privacy store', () => {
  afterEach(() => sessionStorage.clear());

  it('defaults to visible and toggles', () => {
    expect(getHidden()).toBe(false);
    toggleHidden();
    expect(getHidden()).toBe(true);
    toggleHidden();
    expect(getHidden()).toBe(false);
  });

  it('writes to sessionStorage (not localStorage) and clears the key when visible again', () => {
    setHidden(true);
    expect(sessionStorage.getItem('privacy_hidden')).toBe('1');
    expect(localStorage.getItem('privacy_hidden')).toBeNull();
    resetHidden();
    expect(sessionStorage.getItem('privacy_hidden')).toBeNull();
  });

  it('survives a page refresh: a freshly loaded module reads the stored choice', async () => {
    setHidden(true);
    vi.resetModules(); // simulates a reload — module state is gone, sessionStorage remains
    const fresh = await import('@/lib/privacyStore');
    expect(fresh.getHidden()).toBe(true);
  });

  it('still works in memory when sessionStorage throws (blocked storage)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setHidden(true)).not.toThrow();
    expect(getHidden()).toBe(true);
    spy.mockRestore();
  });
});

describe('usePrivacy', () => {
  it('shares one value across every consumer and page-level provider', () => {
    function Probe({ id }: { id: string }) {
      const { hidden, mask } = usePrivacy();
      return <span data-testid={id}>{mask('₹1,00,000')}{hidden ? '' : ''}</span>;
    }
    render(
      <>
        <PrivacyProvider><Probe id="a" /></PrivacyProvider>
        <PrivacyProvider><Probe id="b" /></PrivacyProvider>
      </>,
    );
    expect(screen.getByTestId('a')).toHaveTextContent('₹1,00,000');
    act(() => toggleHidden());
    expect(screen.getByTestId('a')).toHaveTextContent('••••••');
    expect(screen.getByTestId('b')).toHaveTextContent('••••••');
  });

  it('the toggle from the hook flips the shared state, and masks values', () => {
    const { result } = renderHook(() => usePrivacy());
    expect(result.current.mask('x')).toBe('x');
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(true);
    expect(result.current.mask('x')).toBe('••••••');
  });
});
