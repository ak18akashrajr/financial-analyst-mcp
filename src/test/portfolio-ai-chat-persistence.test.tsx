// Regression test for a real bug: PortfolioAI used to hold its conversation
// in local useState, so navigating from /ai to any other page and back
// unmounted the page and blew the whole chat history away. The fix lifts
// that state into PortfolioAIChatContext, mounted once in AppLayout (which
// persists across every protected-page navigation — see AppLayout.tsx and
// SecurityIncidentsProvider for the established pattern). This test
// reproduces that navigation by unmounting/remounting PortfolioAI itself
// while the provider around it stays mounted, which is exactly what
// react-router does to a route's element on an in-app navigation while an
// ancestor layout route element (AppLayout) is untouched.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortfolioAI from '@/pages/PortfolioAI';
import { PortfolioAIChatProvider } from '@/contexts/PortfolioAIChatContext';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'fake-session-token' } } }),
    },
  },
}));

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function fakeSseResponse(events: string[]) {
  const encoder = new TextEncoder();
  let served = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (!served) {
              served = true;
              return { done: false, value: encoder.encode(events.join('')) };
            }
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

async function askQuestion(text: string) {
  const input = screen.getByPlaceholderText('Ask about your portfolio...');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

// Stands in for AppLayout's <Outlet/> swapping between routes: the provider
// (AppLayout) stays mounted across renders, only the child underneath it
// (the routed page) is swapped out and back in, same as react-router does
// on navigation.
function Harness({ showChat }: { showChat: boolean }) {
  return (
    <PortfolioAIChatProvider>
      <MemoryRouter>
        {showChat ? <PortfolioAI /> : <div>Some other page</div>}
      </MemoryRouter>
    </PortfolioAIChatProvider>
  );
}

describe('PortfolioAI chat history persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the conversation after navigating away and back to /ai', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeSseResponse([
          sseEvent('delta', { text: 'Your portfolio is diversified.' }),
          sseEvent('done', { attribution: 'GPT-OSS 20B via Groq' }),
        ]),
      ),
    );

    // Deliberately not one of PRESET_QUESTIONS' own strings — the preset
    // sidebar is always rendered regardless of chat state, so asking one of
    // its exact questions would make it ambiguous whether a later match is
    // the persisted chat bubble or just the ever-present preset button.
    const { rerender } = render(<Harness showChat={true} />);
    await askQuestion('What is my biggest risk today?');
    await waitFor(() => {
      expect(screen.getByText(/Your portfolio is diversified\./)).toBeInTheDocument();
    });

    // Navigate away — PortfolioAI unmounts, another page renders in its place.
    rerender(<Harness showChat={false} />);
    expect(screen.getByText('Some other page')).toBeInTheDocument();
    expect(screen.queryByText(/Your portfolio is diversified\./)).not.toBeInTheDocument();

    // Navigate back — the full history should still be there, not a blank chat.
    rerender(<Harness showChat={true} />);
    expect(screen.getByText('What is my biggest risk today?')).toBeInTheDocument();
    expect(screen.getByText(/Your portfolio is diversified\./)).toBeInTheDocument();
  });

  it('starts a fresh, empty chat for a new provider instance (simulating logout/login)', () => {
    // A brand-new PortfolioAIChatProvider mount (what happens when
    // ProtectedRoute drops AppLayout on logout and a later login remounts
    // it) must not see the previous instance's history.
    render(<Harness showChat={true} />);
    expect(
      screen.getByText('Connected to your live portfolio via MCP.', { exact: false }),
    ).toBeInTheDocument();
  });
});
