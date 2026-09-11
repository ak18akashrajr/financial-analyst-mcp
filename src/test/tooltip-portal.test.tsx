// TooltipContent previously rendered inline instead of through a Radix
// Portal (unlike Popover/DropdownMenu/Dialog/Select in this same ui/
// folder, which all portal to <body>). An InfoHint opened inside any
// scrollable/clipped ancestor — e.g. Projections.tsx's `overflow-x-auto`
// TabsList — got its content cut off at that ancestor's edge instead of
// floating freely above the page. This covers that the content now
// escapes such an ancestor.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoHint } from '@/components/InfoHint';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('InfoHint tooltip portaling', () => {
  it('renders its content outside a clipped/scrollable ancestor', async () => {
    render(
      <TooltipProvider>
        <div data-testid="clipped-ancestor" style={{ overflow: 'hidden' }}>
          <InfoHint title="Overview" side="bottom">
            A what-if sandbox description that would get cut off if clipped.
          </InfoHint>
        </div>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'What is Overview?' }));

    // Radix's Tooltip renders the content into more than one DOM node (visible +
    // an accessibility copy), so assert every match escaped the clipped ancestor
    // rather than relying on a single-match query.
    const matches = await screen.findAllByText(/A what-if sandbox description/);
    expect(matches.length).toBeGreaterThan(0);
    const ancestor = screen.getByTestId('clipped-ancestor');
    matches.forEach((el) => expect(ancestor).not.toContainElement(el));
  });
});
