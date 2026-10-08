// The server releases a complete, guardrail-approved answer in one burst; the chat context paces
// that reveal with a typewriter so it reads as typed instead of popping in. This drives the real
// provider + page against a fake SSE response with motion enabled.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PortfolioAI from '@/pages/PortfolioAI';
import { PortfolioAIChatProvider } from '@/contexts/PortfolioAIChatContext';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'fake-session-token' } } }) },
  },
}));

const sseEvent = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function fakeSseResponse(events: string[]) {
  const encoder = new TextEncoder();
  let served = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (!served) {
            served = true;
            return { done: false, value: encoder.encode(events.join('')) };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  };
}

const ANSWER = 'The portfolio is well diversified across equities and cash, so the overall risk is modest right now.';
const originalMatchMedia = window.matchMedia;

function renderPage() {
  return render(
    <PortfolioAIChatProvider>
      <MemoryRouter>
        <PortfolioAI />
      </MemoryRouter>
    </PortfolioAIChatProvider>,
  );
}

function ask(text: string) {
  const input = screen.getByPlaceholderText('Ask about your portfolio...');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

describe('PortfolioAI typewriter pacing', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeSseResponse([sseEvent('delta', { text: ANSWER }), sseEvent('done', { attribution: 'GPT-OSS 20B via Groq' })]),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.matchMedia = originalMatchMedia;
  });

  // Driven by fake rAF/performance (not wall-clock), so it is deterministic however loaded the machine is.
  it('types the answer out progressively when motion is allowed, then shows it in full', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
      renderPage();
      ask('How risky am I?');

      const lengths: number[] = [];
      let finalText = '';
      for (let i = 0; i < 600; i++) {
        await vi.advanceTimersByTimeAsync(16);
        // Only the answer paragraph (not the rest of the page), so the length tracks the reveal.
        const answer = screen.queryByText(/^The portfolio/);
        if (answer) {
          lengths.push(answer.textContent!.length);
          finalText = answer.textContent!;
        }
        if (finalText.includes('right now.') && screen.queryByText(/GPT-OSS 20B via Groq/)) break;
      }

      // Saw at least one in-between state (not just empty -> full), and it grew monotonically.
      expect(lengths.some((n) => n > 0 && n < ANSWER.length)).toBe(true);
      for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
      expect(finalText).toBe(ANSWER);
      // The attribution footer is revealed too.
      expect(screen.getByText(/GPT-OSS 20B via Groq/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the answer immediately under prefers-reduced-motion', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduced-motion'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    renderPage();
    ask('How risky am I?');
    await waitFor(() => expect(screen.getByText(ANSWER)).toBeInTheDocument(), { timeout: 1000 });
  });
});
