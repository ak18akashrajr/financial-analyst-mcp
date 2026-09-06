// LoginForm now calls real Supabase Auth via useAuth().signIn() instead of
// comparing hardcoded strings. useAuth() is mocked so this stays a unit test.
// Wrapped in a MemoryRouter because LoginForm now navigates on success (see
// the redirect-after-login tests below) — useNavigate()/useLocation() throw
// outside a Router.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginForm, SWAG_LOGIN_ERRORS } from '@/components/LoginForm';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLoginForm(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<LoginForm />} />
        <Route path="/overview" element={<div>Dashboard</div>} />
        <Route path="/reports" element={<div>Reports Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginForm', () => {
  it('calls signIn with the entered email/password on submit', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('me@example.com', 'correct-password'));
  });

  it('shows a swag line — not the raw Supabase text — for a wrong-credentials error', async () => {
    // Math.random is pinned so the swag-line pick is deterministic.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const signIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(SWAG_LOGIN_ERRORS[0])).toBeInTheDocument();
    expect(screen.queryByText(/invalid login credentials/i)).not.toBeInTheDocument();
  });

  it('shows the raw error message for anything other than wrong credentials — no joke on a real failure', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'Email rate limit exceeded' });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Email rate limit exceeded')).toBeInTheDocument();
    SWAG_LOGIN_ERRORS.forEach(line => {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    });
  });

  it('replays the shake animation on the form when a sign-in fails, without clearing the typed fields', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const signIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm();
    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(emailInput, { target: { value: 'me@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByText(SWAG_LOGIN_ERRORS[0]);
    // The form itself carries the shake class (see the force-reflow trick in
    // LoginForm.tsx) — the DOM node isn't remounted, so a wrong-password
    // attempt doesn't blow away what the user already typed.
    expect(screen.getByRole('button', { name: /sign in/i }).closest('form')).toHaveClass('animate-shake');
    expect(emailInput).toHaveValue('me@example.com');
    expect(passwordInput).toHaveValue('wrong');
  });

  it('never hardcodes a working credential locally — the old exploit pair always goes through signIn', async () => {
    // Regression guard for the old vulnerability: username === 'ak18' && password === '2003'
    // compared entirely client-side with no network call at all. Using a
    // validly-formatted email here (the <input type="email"> field applies
    // browser-native format validation, which would otherwise block submit
    // before onSubmit even fires) — the point is the old password '2003'
    // must now always be checked server-side, never accepted locally.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const signIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ak18@old-exploit.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '2003' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('ak18@old-exploit.test', '2003'));
    // The old hardcoded password must now always go through the real auth call
    // (which is mocked to fail here) rather than being accepted locally.
    expect(await screen.findByText(SWAG_LOGIN_ERRORS[0])).toBeInTheDocument();
  });

  it('shows the cosmetic loading sequence, then redirects to the dashboard with no prior destination', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm(['/login']);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // A successful sign-in hands off to LoginLoadingScreen (real timers, ~2.2s
    // of cosmetic stages — see LoginLoadingScreen.tsx) before it navigates on.
    expect(await screen.findByText(/entering your finance world/i)).toBeInTheDocument();
    expect(await screen.findByText('Dashboard', undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('redirects back to the page the user originally tried to reach, via ProtectedRoute\'s state.from', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue({ session: null, loading: false, signIn, signOut: vi.fn() });

    renderLoginForm([{ pathname: '/login', state: { from: { pathname: '/reports' } } }]);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Reports Page', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});
