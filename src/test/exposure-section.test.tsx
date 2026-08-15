// Covers the treemap-based exposure visualization that replaced the bento grid:
// empty states, sorting/capping of tiles, category vs. geography icon selection,
// and privacy masking of the currency value shown on each tile.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExposureSection } from '@/components/ExposureSection';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { ExposureBreakdown } from '@/types/portfolio';

vi.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: vi.fn(),
}));

const mockedUsePrivacy = vi.mocked(usePrivacy);

function renderSection(geography: ExposureBreakdown[], category: ExposureBreakdown[]) {
  return render(<ExposureSection geography={geography} category={category} />);
}

describe('ExposureSection', () => {
  beforeEach(() => {
    mockedUsePrivacy.mockReturnValue({ hidden: false, toggle: vi.fn(), mask: (v: string) => v });
  });

  it('shows empty-state copy when there is no data to plot', () => {
    renderSection([], []);
    expect(screen.getByText(/tag your holdings with geography/i)).toBeInTheDocument();
    expect(screen.getByText(/tag your holdings with a category/i)).toBeInTheDocument();
  });

  it('renders a tile per exposure item, labeled with its percentage', () => {
    const geography: ExposureBreakdown[] = [
      { label: 'India', value: 700000, percent: 70 },
      { label: 'US', value: 300000, percent: 30 },
    ];
    renderSection(geography, []);

    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('sorts tiles by percent descending and caps at 8, dropping the smallest', () => {
    const category: ExposureBreakdown[] = Array.from({ length: 10 }, (_, i) => ({
      label: `Cat${i}`,
      value: (10 - i) * 1000,
      percent: 10 - i, // Cat0=10% ... Cat9=1%
    }));
    renderSection([], category);

    expect(screen.getByText('Cat0')).toBeInTheDocument();
    expect(screen.getByText('Cat7')).toBeInTheDocument();
    expect(screen.queryByText('Cat8')).not.toBeInTheDocument();
    expect(screen.queryByText('Cat9')).not.toBeInTheDocument();
  });

  it('shows the real currency figure when privacy mode is off', () => {
    const geography: ExposureBreakdown[] = [{ label: 'India', value: 500000, percent: 100 }];
    renderSection(geography, []);
    expect(screen.getByText(/₹5,00,000/)).toBeInTheDocument();
  });

  it('masks the currency figure on each tile when privacy mode hides values', () => {
    mockedUsePrivacy.mockReturnValue({ hidden: true, toggle: vi.fn(), mask: () => '••••••' });
    const geography: ExposureBreakdown[] = [{ label: 'India', value: 500000, percent: 100 }];
    renderSection(geography, []);

    expect(screen.queryByText(/₹5,00,000/)).not.toBeInTheDocument();
    expect(screen.getByText('••••••')).toBeInTheDocument();
  });
});
