import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '@/components/EmptyState';

describe('EmptyState', () => {
  it('shows headline, description and action; falls back to a default icon badge', () => {
    const { container } = render(
      <EmptyState text="No goals yet" description="Create one first." action={<a href="/x">Go</a>} />,
    );
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText('Create one first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a provided icon instead of the default', () => {
    render(<EmptyState text="t" icon={<span data-testid="custom-icon" />} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('compact mode stays a plain one-liner: no default icon, no description/action', () => {
    const { container } = render(
      <EmptyState compact text="No data" description="hidden" action={<button>hidden</button>} />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
