import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '@/components/ui/card';

describe('Card', () => {
  it('defaults to a rounded-xl surface with a soft shadow, and lets callers override the radius', () => {
    const { container, rerender } = render(<Card />);
    const el = () => container.firstElementChild as HTMLElement;
    expect(el()).toHaveClass('rounded-xl', 'shadow-sm', 'border');
    expect(el()).not.toHaveClass('card-interactive');

    rerender(<Card className="rounded-2xl" />);
    expect(el()).toHaveClass('rounded-2xl');
    expect(el()).not.toHaveClass('rounded-xl');
  });

  it('adds the hover-lift utility only when interactive', () => {
    const { container } = render(<Card interactive />);
    expect(container.firstElementChild).toHaveClass('card-interactive');
  });

  it('defines .card-interactive in the components layer', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
    expect(css).toMatch(/@layer components\s*\{[\s\S]*\.card-interactive\s*\{[\s\S]*hover:-translate-y-0\.5/);
  });
});
