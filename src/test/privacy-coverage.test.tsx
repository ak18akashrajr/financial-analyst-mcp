import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PortfolioAI from '@/pages/PortfolioAI';
import { PortfolioAIChatProvider } from '@/contexts/PortfolioAIChatContext';
import { setHidden } from '@/lib/privacyStore';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

const renderAI = () =>
  render(
    <PortfolioAIChatProvider>
      <MemoryRouter>
        <PortfolioAI />
      </MemoryRouter>
    </PortfolioAIChatProvider>,
  );

describe('AI page notice when numbers are hidden', () => {
  it('tells the user the assistant\'s answers are not masked, only while hidden', () => {
    const { unmount } = renderAI();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    unmount();

    setHidden(true);
    renderAI();
    expect(screen.getByRole('note')).toHaveTextContent(/assistant's answers still show real figures/i);
  });
});

describe('Reports chart axes', () => {
  it('every rupee-amount axis is masked while hidden (the "300k" scale leaked portfolio size)', () => {
    const src = readFileSync(resolve(__dirname, '../pages/Reports.tsx'), 'utf-8');
    const axes = src.match(/tickFormatter=\{\(v\) => [^\n]*\/ 1000\)\.toFixed\(0\)\}k`[^\n]*\}/g) ?? [];
    expect(axes).toHaveLength(3);
    axes.forEach((a) => expect(a).toContain("hidden ? '•••'"));
  });
});
