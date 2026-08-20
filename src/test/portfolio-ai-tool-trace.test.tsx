// Covers PortfolioAI's MCP tool-call transparency: previously only the
// currently-running tool was shown (overwritten on each new call, vanishing
// entirely once the answer streamed in) — a black box in practice, since a
// multi-tool answer's earlier calls left no visible trace. Now every tool
// call this turn accumulates live, and the full ordered trace is attached to
// the finished assistant message so it's visible after the fact too.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortfolioAI from '@/pages/PortfolioAI';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Builds a fetch Response stand-in whose body yields every event in one
 * chunk — streamChat's buffer-splitting logic parses multiple "\n\n"
 * delimited events out of a single read() just fine, so one chunk is
 * enough to exercise the real parsing path without a multi-read fixture. */
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

function renderPage() {
  return render(
    <MemoryRouter>
      <PortfolioAI />
    </MemoryRouter>,
  );
}

async function askQuestion(text: string) {
  const input = screen.getByPlaceholderText('Ask about your portfolio...');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

describe('PortfolioAI MCP tool-call transparency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the full ordered tool-call trace to the finished answer, not just the last tool called', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeSseResponse([
          sseEvent('tool_call', { name: 'get_portfolio_summary', args: {} }),
          sseEvent('tool_call', { name: 'get_concentration_risk', args: {} }),
          sseEvent('delta', { text: 'Your portfolio is diversified.' }),
          sseEvent('done', { attribution: 'Claude Sonnet 5' }),
        ]),
      ),
    );

    renderPage();
    await askQuestion('What is my biggest risk right now?');

    await waitFor(() => {
      expect(screen.getByText(/Your portfolio is diversified\./)).toBeInTheDocument();
    });

    // Both tools appear in the persisted trace, in call order — not just
    // whichever one happened to be running last.
    const trace = screen.getByText(/Used 2 MCP tools:/);
    expect(trace).toHaveTextContent('Get Portfolio Summary → Get Concentration Risk');
  });

  it('shows no trace line for an answer that never called a tool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeSseResponse([
          sseEvent('delta', { text: "I can only answer questions about your own portfolio." }),
          sseEvent('done', { attribution: 'Claude Sonnet 5' }),
        ]),
      ),
    );

    renderPage();
    await askQuestion('What is the capital of France?');

    await waitFor(() => {
      expect(screen.getByText(/only answer questions about your own portfolio/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Used \d+ MCP tool/)).not.toBeInTheDocument();
  });
});
