import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '@/components/ui/skeleton';

describe('Skeleton', () => {
  it('uses the shimmer sweep instead of a whole-block pulse, and keeps caller classes', () => {
    const { container } = render(<Skeleton data-testid="s" className="h-4 w-20" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('before:animate-shimmer');
    expect(el.className).not.toContain('animate-pulse');
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-20');
  });

  it('shimmer keyframes and animation are registered in the tailwind config', () => {
    const cfg = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf-8');
    expect(cfg).toMatch(/shimmer:\s*\{/);
    expect(cfg).toMatch(/shimmer:\s*"shimmer /);
  });
});
