// Mirrors login-loading-screen.test.tsx's pattern for the same timed stage/fade sequence, just
// personalized with the picked "Who's Watching" profile's name.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileEnterLoadingScreen } from '@/components/ProfileEnterLoadingScreen';

describe('ProfileEnterLoadingScreen', () => {
  it('greets the picked profile by name and calls onDone once the sequence finishes', async () => {
    const onDone = vi.fn();
    render(<ProfileEnterLoadingScreen name="Rethinasamy" onDone={onDone} />);

    expect(screen.getByText(/hi rethinasamy, welcome back/i)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    // Real timers — the full sequence (4 stages + completion flourish + fade-out) is ~1.65s,
    // see ProfileEnterLoadingScreen.tsx.
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('advances through every stage in order, then shows a completion flourish before finishing', async () => {
    render(<ProfileEnterLoadingScreen name="Fam" onDone={() => {}} />);

    expect(screen.getByText(/hi fam, welcome back/i)).toBeInTheDocument();
    expect(await screen.findByText(/setting up your dashboard/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(await screen.findByText(/loading your holdings/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(await screen.findByText(/pulling up your view/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(await screen.findByText(/you're in/i, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});
