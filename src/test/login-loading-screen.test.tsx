import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginLoadingScreen } from '@/components/LoginLoadingScreen';

describe('LoginLoadingScreen', () => {
  it('starts on the first stage and calls onDone once the sequence finishes', async () => {
    const onDone = vi.fn();
    render(<LoginLoadingScreen onDone={onDone} />);

    expect(screen.getByText(/entering your finance world/i)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    // Real timers — the full sequence is ~2.2s (see LoginLoadingScreen.tsx).
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('advances through every stage in order before finishing', async () => {
    render(<LoginLoadingScreen onDone={() => {}} />);

    expect(screen.getByText(/entering your finance world/i)).toBeInTheDocument();
    expect(await screen.findByText(/pulling up your portfolio/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(await screen.findByText(/processing holdings/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(await screen.findByText(/analyzing exposure/i, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});
