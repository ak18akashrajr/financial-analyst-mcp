// Covers the "checked" / "changed" timestamps shown below the Prices refresh
// button. Previously a single "last updated" line conflated "we asked
// Yahoo" with "a price actually moved" — those stopped being the same event
// once fetch-prices started skipping no-op writes (see
// docs/scaling-and-archival-plan.md's addendum).
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PriceRefreshButton } from '@/components/PriceRefreshButton';

describe('PriceRefreshButton', () => {
  it('shows no timestamp lines when prices have never been checked', () => {
    render(
      <PriceRefreshButton fetchingPrices={false} disabled={false} lastPriceCheckTime={null} lastPriceChangeTime={null} onClick={vi.fn()} />,
    );
    expect(screen.queryByText(/Checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Changed/)).not.toBeInTheDocument();
  });

  it('shows only the checked line when nothing has changed yet', () => {
    render(
      <PriceRefreshButton
        fetchingPrices={false}
        disabled={false}
        lastPriceCheckTime="20 Aug '26, 5:30 PM"
        lastPriceChangeTime={null}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Checked 20 Aug '26, 5:30 PM")).toBeInTheDocument();
    expect(screen.queryByText(/Changed/)).not.toBeInTheDocument();
  });

  it('shows both lines once a price has actually changed', () => {
    render(
      <PriceRefreshButton
        fetchingPrices={false}
        disabled={false}
        lastPriceCheckTime="20 Aug '26, 5:30 PM"
        lastPriceChangeTime="19 Aug '26, 3:40 PM"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Checked 20 Aug '26, 5:30 PM")).toBeInTheDocument();
    expect(screen.getByText("Changed 19 Aug '26, 3:40 PM")).toBeInTheDocument();
  });

  it('exposes both timestamps via the title attribute for hover', () => {
    render(
      <PriceRefreshButton
        fetchingPrices={false}
        disabled={false}
        lastPriceCheckTime="20 Aug '26, 5:30 PM"
        lastPriceChangeTime="19 Aug '26, 3:40 PM"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      "Last checked: 20 Aug '26, 5:30 PM · Last price change: 19 Aug '26, 3:40 PM",
    );
  });

  it('falls back to a plain hint title before any check has happened', () => {
    render(
      <PriceRefreshButton fetchingPrices={false} disabled={false} lastPriceCheckTime={null} lastPriceChangeTime={null} onClick={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Fetch live prices');
  });

  it('calls onClick when the button is clicked', async () => {
    const onClick = vi.fn();
    render(
      <PriceRefreshButton fetchingPrices={false} disabled={false} lastPriceCheckTime={null} lastPriceChangeTime={null} onClick={onClick} />,
    );
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button while fetching or when there are no holdings to price', () => {
    const { rerender } = render(
      <PriceRefreshButton fetchingPrices={true} disabled={false} lastPriceCheckTime={null} lastPriceChangeTime={null} onClick={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toBeDisabled();

    rerender(
      <PriceRefreshButton fetchingPrices={false} disabled={true} lastPriceCheckTime={null} lastPriceChangeTime={null} onClick={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
