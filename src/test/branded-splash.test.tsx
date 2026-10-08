import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandedSplash } from '@/components/BrandedSplash';

describe('BrandedSplash', () => {
  it('announces loading to assistive tech exactly once', () => {
    render(<BrandedSplash />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getAllByText(/loading/i)).toHaveLength(1);
  });

  it('fills the viewport by default and can opt out', () => {
    const { rerender } = render(<BrandedSplash />);
    expect(screen.getByRole('status')).toHaveClass('min-h-screen');
    rerender(<BrandedSplash fullScreen={false} />);
    expect(screen.getByRole('status')).not.toHaveClass('min-h-screen');
  });
});
