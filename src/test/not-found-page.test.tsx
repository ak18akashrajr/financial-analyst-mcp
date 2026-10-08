import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NotFound from '@/pages/NotFound';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/nope']}>
      <NotFound />
    </MemoryRouter>,
  );

describe('NotFound', () => {
  it('sends a signed-out visitor back to the landing page', () => {
    vi.mocked(useAuth).mockReturnValue({ session: null, loading: false, signIn: vi.fn(), signOut: vi.fn() });
    renderPage();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Home' })).toHaveAttribute('href', '/');
  });

  it('sends a signed-in user back to the dashboard instead of the public landing page', () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'fake' } as never,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/overview');
  });
});
