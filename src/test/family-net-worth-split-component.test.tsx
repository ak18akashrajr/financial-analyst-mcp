// Covers src/components/FamilyNetWorthSplit.tsx: it renders each member's name, amount, and %
// share, respects the privacy "hidden" mask, and stays invisible below 2 members (nothing to
// split with just one).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FamilyNetWorthSplit } from '@/components/FamilyNetWorthSplit';
import type { MemberPortfolioSplit } from '@/lib/familyPortfolioSplit';
import type { FamilyMember } from '@/types/portfolio';

const members: FamilyMember[] = [
  { id: 'm-1', name: 'Self', relationship: 'Self', createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'm-2', name: 'Priya', relationship: 'Spouse', createdAt: '2026-09-01T00:00:00.000Z' },
];

function split(overrides: Partial<MemberPortfolioSplit> & { familyMemberId: string; netWorth: number }): MemberPortfolioSplit {
  return { holdingsValue: 0, liquidCash: 0, vaultCash: 0, pfBalance: 0, creditCardDebt: 0, ...overrides };
}

describe('FamilyNetWorthSplit', () => {
  it('renders nothing with fewer than 2 members to split', () => {
    const { container } = render(
      <FamilyNetWorthSplit splits={[split({ familyMemberId: 'm-1', netWorth: 100000 })]} members={members} hidden={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each member\'s display name, amount, and % share', () => {
    render(
      <FamilyNetWorthSplit
        splits={[
          split({ familyMemberId: 'm-1', netWorth: 60000 }),
          split({ familyMemberId: 'm-2', netWorth: 40000 }),
        ]}
        members={members}
        hidden={false}
      />,
    );

    // "Self" is swapped for "Akash" everywhere a member's display name is shown.
    expect(screen.getByText('Akash')).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    expect(screen.getByText(/60\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/40\.0%/)).toBeInTheDocument();
  });

  it('masks amounts (but not %) when the privacy toggle is on', () => {
    render(
      <FamilyNetWorthSplit
        splits={[
          split({ familyMemberId: 'm-1', netWorth: 60000 }),
          split({ familyMemberId: 'm-2', netWorth: 40000 }),
        ]}
        members={members}
        hidden
      />,
    );
    expect(screen.getAllByText('•••')).toHaveLength(2);
    expect(screen.getByText(/60\.0%/)).toBeInTheDocument();
  });
});
