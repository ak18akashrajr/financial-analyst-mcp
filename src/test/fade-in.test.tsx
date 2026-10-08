import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FadeIn } from '@/components/FadeIn';

describe('FadeIn', () => {
  it('staggers by index and caps the delay so late sections are not held back', () => {
    render(
      <>
        <FadeIn index={0}><span>a</span></FadeIn>
        <FadeIn index={3}><span>b</span></FadeIn>
        <FadeIn index={50}><span>c</span></FadeIn>
      </>,
    );
    expect(screen.getByText('a').parentElement).toHaveStyle({ animationDelay: '0ms' });
    expect(screen.getByText('b').parentElement).toHaveStyle({ animationDelay: '180ms' });
    expect(screen.getByText('c').parentElement).toHaveStyle({ animationDelay: '480ms' });
  });

  it('stays invisible until its delay elapses and collapses when its child renders nothing', () => {
    const { container } = render(<FadeIn index={1}>{null}</FadeIn>);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass('fill-mode-backwards');
    expect(el).toHaveClass('empty:hidden');
    expect(el).toBeEmptyDOMElement();
  });
});
