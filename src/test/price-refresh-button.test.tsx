// Covers the explicit "last updated" timestamp added below the Prices
// refresh button — previously only visible on hover via the button's
// title attribute (see Index.tsx history), now also shown as plain,
// always-visible text.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PriceRefreshButton } from '@/components/PriceRefreshButton';

describe('PriceRefreshButton', () => {
  it('shows no timestamp line when prices have never been fetched', () => {
    render(<PriceRefreshButton fetchingPrices={false} disabled={false} lastPriceFetchTime={null} onClick={vi.fn()} />);
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it('shows the last-updated time explicitly below the button once prices have been fetched', () => {
    render(
      <PriceRefreshButton
        fetchingPrices={false}
        disabled={false}
        lastPriceFetchTime="20 Aug '26, 5:30 PM"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Updated 20 Aug '26, 5:30 PM")).toBeInTheDocument();
  });

  it('still exposes the same detail via the title attribute for hover', () => {
    render(
      <PriceRefreshButton
        fetchingPrices={false}
        disabled={false}
        lastPriceFetchTime="20 Aug '26, 5:30 PM"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('title', "Last updated: 20 Aug '26, 5:30 PM");
  });

  it('calls onClick when the button is clicked', async () => {
    const onClick = vi.fn();
    render(<PriceRefreshButton fetchingPrices={false} disabled={false} lastPriceFetchTime={null} onClick={onClick} />);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button while fetching or when there are no holdings to price', () => {
    const { rerender } = render(
      <PriceRefreshButton fetchingPrices={true} disabled={false} lastPriceFetchTime={null} onClick={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toBeDisabled();

    rerender(<PriceRefreshButton fetchingPrices={false} disabled={true} lastPriceFetchTime={null} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
