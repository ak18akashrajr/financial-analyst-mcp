// AuditPopover previously hardcoded its PopoverContent to w-[420px] with no viewport
// clamp, and its AuditTable wrapper used overflow-hidden instead of overflow-x-auto —
// together these meant the audit popover (used throughout Reports.tsx and
// DollarAdjustedReturns.tsx) didn't fit, and couldn't scroll, on phone-width screens.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditPopover, AuditTable } from '@/components/AuditPopover';

describe('AuditPopover mobile width', () => {
  it('clamps the popover content to the viewport width instead of a fixed 420px', async () => {
    render(
      <AuditPopover title="Example" trigger={<span>Open audit</span>}>
        <p>Body</p>
      </AuditPopover>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Show source calculation for Example/i }));

    const content = await screen.findByText('Body');
    const popoverContent = content.closest('[class*="w-\\[420px\\]"]');
    expect(popoverContent).not.toBeNull();
    expect(popoverContent).toHaveClass('max-w-[calc(100vw-2rem)]');
  });

  it('gives the audit table a horizontal-scroll wrapper instead of clipping it', () => {
    render(<AuditTable headers={['Symbol', 'Qty', 'Avg', 'Mark', 'Value', 'Src']} rows={[]} />);

    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(table.parentElement).not.toHaveClass('overflow-hidden');
  });
});
