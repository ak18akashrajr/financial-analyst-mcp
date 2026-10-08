import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

describe('global focus-visible ring', () => {
  it('covers hand-rolled buttons, links and ARIA controls at zero specificity', () => {
    const m = /:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(m, 'focus-visible rule').not.toBeNull();
    for (const sel of ['button', 'a[href]', '[role="tab"]', '[role="switch"]']) expect(m![1]).toContain(sel);
    expect(m![2]).toContain('outline: 2px solid hsl(var(--ring))');
  });
});
