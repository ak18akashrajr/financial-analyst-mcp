import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HoldingsTable } from '@/components/HoldingsTable';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

describe('sticky table headers', () => {
  it('defines .sticky-thead to pin th cells with an opaque layered background', () => {
    const css = read('src/index.css');
    const rule = /\.sticky-thead thead th\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('top: 0');
    expect(rule).toContain('hsl(var(--card))');
  });

  it('long tables scroll inside a height-capped wrapper (sticky needs a vertical scroll container)', () => {
    for (const file of ['src/components/HoldingsTable.tsx', 'src/pages/Taxes.tsx', 'src/pages/RollingReturns.tsx']) {
      const src = read(file);
      expect(src, file).toContain('sticky-thead');
      expect(src, file).toContain('max-h-[70vh]');
    }
  });

  it('HoldingsTable renders its table inside the sticky wrapper', () => {
    const holding = {
      symbol: 'TCS', quantity: 1, avgPrice: 100, currentPrice: 110, geography: 'India', category: 'Equity',
      investedValue: 100, currentValue: 110, pnl: 10, pnlPercent: 10,
    } as never;
    const { container } = render(
      <HoldingsTable
        holdings={[holding]}
        onUpdatePrice={vi.fn()}
        onUpdateTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
        onUpdateMetadata={vi.fn()}
      />,
    );
    const wrapper = container.querySelector('table')!.parentElement!;
    expect(wrapper).toHaveClass('sticky-thead', 'overflow-auto');
  });
});
