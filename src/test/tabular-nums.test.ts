import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
const summaryBar = readFileSync(resolve(__dirname, '../components/SummaryBar.tsx'), 'utf-8');

describe('tabular numerals', () => {
  it('every table gets fixed-width digits via the base layer', () => {
    expect(css).toMatch(/table\s*\{\s*font-variant-numeric:\s*tabular-nums;/);
  });

  it('the summary bar stat values use tabular-nums', () => {
    // hero AUM + StatCard value + the two MiniStat value variants
    expect(summaryBar.match(/tabular-nums/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
