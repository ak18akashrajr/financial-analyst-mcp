import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GridSkeleton, PageSkeleton, StatGridSkeleton } from '@/components/PageSkeleton';

describe('section skeletons', () => {
  it('GridSkeleton renders rows x cols placeholder cells with an accessible label', () => {
    const { container } = render(<GridSkeleton rows={3} cols={4} label="Loading snapshots…" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading snapshots…')).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="animate-shimmer"]')).toHaveLength(12);
  });

  it('StatGridSkeleton renders the requested number of stat placeholders', () => {
    const { container } = render(<StatGridSkeleton cells={3} label="Loading FX data…" />);
    expect(screen.getByText('Loading FX data…')).toBeInTheDocument();
    // two skeleton lines (label + value) per cell
    expect(container.querySelectorAll('[class*="animate-shimmer"]')).toHaveLength(6);
  });

  it('PageSkeleton defaults to a chart block and switches to a table block via variant', () => {
    const { rerender } = render(<PageSkeleton />);
    expect(screen.queryByTestId('table-skeleton')).not.toBeInTheDocument();
    rerender(<PageSkeleton variant="table" />);
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
    rerender(<PageSkeleton variant="table" withChart={false} />);
    expect(screen.queryByTestId('table-skeleton')).not.toBeInTheDocument();
  });
});
