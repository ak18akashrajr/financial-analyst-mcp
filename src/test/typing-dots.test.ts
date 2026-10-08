import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

describe('AI chat typing indicator', () => {
  it('uses the travelling-hop animation (not a flat pulse) and it is registered in tailwind', () => {
    const page = read('src/pages/PortfolioAI.tsx');
    expect(page).toContain('animate-typing-dot');
    const cfg = read('tailwind.config.ts');
    expect(cfg).toMatch(/"typing-dot":\s*\{/);
    expect(cfg).toMatch(/"typing-dot":\s*"typing-dot /);
  });
});
