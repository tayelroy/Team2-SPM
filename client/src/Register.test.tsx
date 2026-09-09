import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Register from './Register';

let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  // jsdom doesn't implement real navigation; swap in a plain mutable object
  // so assigning `.href` is observable instead of silently no-op'ing.
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

function fillForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
  fireEvent.change(screen.getByLabelText('Organisation'), { target: { value: 'Analytical Engines Ltd' } });
}

test('submits the form fields as JSON to the register endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message: 'Account created successfully.', userId: 'user-123' }), { status: 201 })
  );
  vi.stubGlobal('fetch', fetchMock);

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(await screen.findByText('Account created successfully.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      organisation: 'Analytical Engines Ltd'
    })
  });
});

test('clears the form and shows a success message after registering', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Account created successfully.' }), { status: 201 }))
  );

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  await screen.findByText('Account created successfully.');
  expect(screen.getByLabelText('Name')).toHaveValue('');
  expect(screen.getByLabelText('Email')).toHaveValue('');
});

test('shows the server error message on a duplicate email', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'An account with this email address already exists.' }), { status: 409 })
    )
  );

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(await screen.findByText('An account with this email address already exists.')).toBeInTheDocument();
});

test('shows a generic message when the server is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(
    await screen.findByText('Could not reach the server. Check your connection and try again.')
  ).toBeInTheDocument();
});

test('the header Sign in button takes you to the homepage', () => {
  render(<Register />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(window.location.href).toBe('/');
});

test('redirects to the homepage shortly after a successful registration', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Account created successfully.' }), { status: 201 }))
  );

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  await screen.findByRole('status');
  expect(window.location.href).toBe('');

  await new Promise((resolve) => setTimeout(resolve, 1600));
  expect(window.location.href).toBe('/');
}, 10000);

test('does not redirect after an unsuccessful registration', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'An account with this email address already exists.' }), { status: 409 })
    )
  );

  render(<Register />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));

  await screen.findByRole('alert');
  await new Promise((resolve) => setTimeout(resolve, 1600));
  expect(window.location.href).toBe('');
}, 10000);
