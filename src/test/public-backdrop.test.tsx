import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PublicBackdrop } from '@/components/PublicBackdrop';
import Landing from '@/pages/Landing';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));

describe('PublicBackdrop', () => {
  it('renders children above decorative layers that are hidden from assistive tech', () => {
    const { container } = render(<PublicBackdrop><p>content</p></PublicBackdrop>);
    expect(screen.getByText('content')).toBeInTheDocument();
    const decorative = container.querySelectorAll('[aria-hidden="true"]');
    expect(decorative.length).toBe(2);
    decorative.forEach((el) => expect(el).toHaveClass('pointer-events-none'));
  });
});

describe('Landing feature teaser', () => {
  it('lists what is inside without adding a second login link', () => {
    vi.mocked(useAuth).mockReturnValue({ session: null, loading: false, signIn: vi.fn(), signOut: vi.fn() });
    render(<MemoryRouter><Landing /></MemoryRouter>);
    const list = screen.getByRole('list', { name: /what's inside/i });
    expect(list.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getAllByRole('link', { name: /login/i })).toHaveLength(1);
  });
});
