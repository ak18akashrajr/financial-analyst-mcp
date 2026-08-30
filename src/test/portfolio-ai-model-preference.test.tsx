// Covers PortfolioAI's opt-in model-selector toggle (docs/openrouter-nemotron-plan.md):
// defaults to 'auto', and the chosen preference is threaded into the POST
// body sent to portfolio-ai. The backend's own routing/fallback behavior is
// covered separately in supabase/functions/portfolio-ai/model-preference-gate.test.ts;
// this only checks the frontend wires the selected value through.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortfolioAI from '@/pages/PortfolioAI';

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

describe('PortfolioAI model-selector toggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to auto and sends it as modelPreference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeSseResponse([
        sseEvent('delta', { text: 'answer' }),
        sseEvent('done', { attribution: 'GPT-OSS 20B via Groq' }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    expect(screen.getByLabelText('Model:')).toHaveValue('auto');

    await askQuestion('What is my biggest risk?');
    await waitFor(() => expect(screen.getByText(/answer/)).toBeInTheDocument());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.modelPreference).toBe('auto');
  });

  it('sends the selected opt-in model as modelPreference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeSseResponse([
        sseEvent('delta', { text: 'answer' }),
        sseEvent('done', { attribution: 'NVIDIA Nemotron 3 Ultra via OpenRouter' }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.change(screen.getByLabelText('Model:'), { target: { value: 'nemotron' } });

    await askQuestion('What is my biggest risk?');
    await waitFor(() => expect(screen.getByText(/answer/)).toBeInTheDocument());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.modelPreference).toBe('nemotron');
  });
});
