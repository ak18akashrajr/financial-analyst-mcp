import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom doesn't evaluate media queries or stylesheets, so this guards the rule's presence/shape
// (it's what makes every animate-* / transition-* class respect the OS reduce-motion setting).
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

describe('prefers-reduced-motion', () => {
  it('has a global reduce-motion block that collapses animations and transitions', () => {
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
    expect(block).toContain('animation-iteration-count: 1 !important');
  });

  it('exempts spinners so a working indicator never looks frozen', () => {
    expect(block).toContain(':not(.animate-spin)');
  });
});
