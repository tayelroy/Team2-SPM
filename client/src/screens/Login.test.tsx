import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Login from './Login';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-9' } });
}

test('submits credentials and hands the session to onSignIn', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: { userId: 'user-1', email: 'ada@example.com', role: 'Venue Staff' }
      }),
      { status: 200 }
    )
  );
  vi.stubGlobal('fetch', fetchMock);
  const onSignIn = vi.fn();

  render(<Login onSignIn={onSignIn} onBack={vi.fn()} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  await vi.waitFor(() => expect(onSignIn).toHaveBeenCalledOnce());
  expect(onSignIn).toHaveBeenCalledWith({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: { userId: 'user-1', email: 'ada@example.com', role: 'Venue Staff' }
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ada@example.com', password: 'Correct-Horse-9' })
  });
});

test('shows the server error message on invalid credentials, and does not sign in', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401 }))
  );
  const onSignIn = vi.fn();

  render(<Login onSignIn={onSignIn} onBack={vi.fn()} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  expect(onSignIn).not.toHaveBeenCalled();
});

test('uses a fallback message when the error response has none', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway unavailable</html>', { status: 502 })));

  render(<Login onSignIn={vi.fn()} onBack={vi.fn()} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByText('Sign-in failed. Please try again.')).toBeInTheDocument();
});

test('shows a generic message when the server is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

  render(<Login onSignIn={vi.fn()} onBack={vi.fn()} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(
    await screen.findByText('Could not reach the server. Check your connection and try again.')
  ).toBeInTheDocument();
});

test('a second click while a request is outstanding does not submit again', async () => {
  let resolveResponse!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveResponse = resolve; }));
  vi.stubGlobal('fetch', fetchMock);

  render(<Login onSignIn={vi.fn()} onBack={vi.fn()} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Signing in…' }));
  expect(fetchMock).toHaveBeenCalledOnce();

  resolveResponse(
    new Response(
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { userId: '1', email: 'x', role: 'Attendee' } }),
      { status: 200 }
    )
  );
});

test('the wordmark calls onBack', () => {
  const onBack = vi.fn();
  render(<Login onSignIn={vi.fn()} onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: /ConnectSphere/ }));
  expect(onBack).toHaveBeenCalledOnce();
});
