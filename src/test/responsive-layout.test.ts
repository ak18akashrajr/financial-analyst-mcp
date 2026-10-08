import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Layout regressions found by clicking through the deployed app at tablet width (768-1023px), where the
// 244px sidebar leaves only ~480-760px for the page. Breakpoints are viewport-based, so a page that was
// laid out for "md" (768px) has far less room than its breakpoint assumes once the sidebar is showing.
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

describe('tablet-width layout', () => {
  it('AI chat: the preset-question column and the mobile preset chips switch at the same breakpoint (lg)', () => {
    const src = read('src/pages/PortfolioAI.tsx');
    // The 320px question list squeezed the chat to ~170px at 768px; it now appears from lg up...
    expect(src).toMatch(/w-80 border-r[^"]*hidden lg:flex/);
    // ...and the chips that stand in for it must cover exactly the range where the list is hidden.
    expect(src).toMatch(/max-w-lg lg:hidden/);
    expect(src).not.toMatch(/max-w-lg md:hidden/);
  });

  it('cash mini-stats use 3 columns until xl so labels are not truncated to one letter', () => {
    expect(read('src/components/SummaryBar.tsx')).toContain('grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5');
  });

  it('market regime tiles stay at 2 columns until lg so "Expensive" is not clipped', () => {
    expect(read('src/components/deployment/MarketRegimeStrip.tsx')).toContain('grid grid-cols-2 lg:grid-cols-4');
  });
});
