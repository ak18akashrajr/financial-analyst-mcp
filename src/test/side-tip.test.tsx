import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SideTip } from '@/components/SideTip';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('SideTip', () => {
  it('renders the child untouched when there is no label', () => {
    render(<TooltipProvider><SideTip><button>plain</button></SideTip></TooltipProvider>);
    expect(screen.getByRole('button', { name: 'plain' })).toBeInTheDocument();
  });

  it('shows a themed tooltip when the control is focused (keyboard) ', async () => {
    render(<TooltipProvider delayDuration={0}><SideTip label="Hello tip"><button>trigger</button></SideTip></TooltipProvider>);
    fireEvent.focus(screen.getByRole('button', { name: 'trigger' }));
    expect((await screen.findAllByText('Hello tip')).length).toBeGreaterThan(0);
  });
});
