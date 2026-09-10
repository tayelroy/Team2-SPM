import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Register from './Register';

let originalLocation: Location;

beforeEach(() => {
  vi.useFakeTimers();
  originalLocation = window.location;
  // Observe navigation without asking jsdom to load another document.
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

function fillForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
  fireEvent.change(screen.getByLabelText('Organisation'), { target: { value: 'Analytical Engines Ltd' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Attendee' } });
}

async function submit() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register' })); });
}

test('submits once, clears all fields on success and redirects at the 1500 ms boundary', async () => {
  let resolveResponse!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { resolveResponse = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<Register />);
  fillForm();
  await submit();

  // A second click while the first request is outstanding must not create another account.
  fireEvent.click(screen.getByRole('button', { name: 'Registering…' }));
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Lovelace', email: 'ada@example.com',
      password: 'correct-horse-battery', organisation: 'Analytical Engines Ltd',
      role: 'Attendee'
    })
  });

  await act(async () => {
    resolveResponse(Response.json({ message: 'Account created successfully.', userId: 'user-123' }, { status: 201 }));
  });
  expect(screen.getByRole('status')).toHaveTextContent('Account created successfully.');
  for (const label of ['Name', 'Email', 'Password', 'Organisation', 'Role']) {
    expect(screen.getByLabelText(label)).toHaveValue('');
  }
  act(() => vi.advanceTimersByTime(1499));
  expect(window.location.href).toBe('');
  act(() => vi.advanceTimersByTime(1));
  expect(window.location.href).toBe('/?screen=login');
});

test('duplicate-email rejection keeps the inputs and does not redirect', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
    { error: 'An account with this email address already exists.' }, { status: 409 }
  )));
  render(<Register />);
  fillForm();
  await submit();
  expect(screen.getByRole('alert')).toHaveTextContent('An account with this email address already exists.');
  expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  act(() => vi.advanceTimersByTime(1501));
  expect(window.location.href).toBe('');
});

test('network failure shows a recoverable error and permits retry', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValueOnce(Response.json({ message: 'Account created successfully.' }, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<Register />);
  fillForm();
  await submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Check your connection and try again.');
  expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  await submit();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('Account created successfully.');
});

test.each([
  [502, '<html>gateway unavailable</html>', 'alert', 'Registration failed. Please try again.'],
  [201, '{}', 'status', 'Account created successfully. Taking you to sign in…'],
])('uses a fallback message for HTTP %s without a usable message', async (status, body, role, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
  const { unmount } = render(<Register />);
  fillForm();
  await submit();
  expect(screen.getByRole(role)).toHaveTextContent(message);
  unmount();
  act(() => vi.advanceTimersByTime(1501));
  expect(window.location.href).toBe('');
});

test('the header Sign in button opens sign in', () => {
  render(<Register />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(window.location.href).toBe('/?screen=login');
});

test('role options exclude Technical Support Staff (self-registration is limited to non-privileged roles)', () => {
  render(<Register />);
  const options = screen.getAllByRole('option').map((option) => option.textContent);
  expect(options).toEqual(['Choose a role', 'Event Organiser', 'Event Coordinator', 'Venue Staff', 'Attendee']);
});
