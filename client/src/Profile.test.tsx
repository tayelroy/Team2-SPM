import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Profile from './Profile';

beforeEach(() => {
  window.localStorage.setItem('devUserId', 'u1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const sampleProfile = {
  id: 'u1',
  name: 'Marcus Chua',
  email: 'marcus@example.com',
  phone: '+65 9123 4567',
  communication_preferences: ['email']
};

test('shows a message when no dev user id is set', async () => {
  window.localStorage.clear();
  render(<Profile />);
  expect(await screen.findByText(/No user signed in/)).toBeInTheDocument();
});

test('loads and displays the profile', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleProfile))));
  render(<Profile />);
  expect(screen.getByText('Loading profile...')).toBeInTheDocument();
  expect(await screen.findByDisplayValue('Marcus Chua')).toBeInTheDocument();
  expect(screen.getByDisplayValue('marcus@example.com')).toBeInTheDocument();
});

test('shows the department field for internal users', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...sampleProfile, department: 'Engineering' })))
  );
  render(<Profile />);
  expect(await screen.findByText('Department: Engineering')).toBeInTheDocument();
});

test('shows a load error when the API call fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404 })));
  render(<Profile />);
  expect(await screen.findByText('Error: Profile not found')).toBeInTheDocument();
});

test('falls back to a generic HTTP error when the error body has no message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 500 })));
  render(<Profile />);
  expect(await screen.findByText('Error: HTTP error: 500')).toBeInTheDocument();
});

test('falls back to a generic save error when the PUT error body has no details or message', async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(sampleProfile)));
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);

  render(<Profile />);
  await screen.findByDisplayValue('Marcus Chua');
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText('Could not save profile.')).toBeInTheDocument();
});

test('saves changes and shows validation errors returned by the server', async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(sampleProfile)));
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Invalid profile details', details: ['Email address is not valid.'] }), {
      status: 400
    })
  );
  vi.stubGlobal('fetch', fetchMock);

  render(<Profile />);
  const emailInput = await screen.findByDisplayValue('marcus@example.com');
  fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText('Email address is not valid.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [, putCall] = fetchMock.mock.calls;
  expect(putCall[1].method).toBe('PUT');
});

test('saves changes successfully and reflects the returned profile', async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(sampleProfile)));
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ...sampleProfile, name: 'Marcus C.', department: 'Engineering' }))
  );
  vi.stubGlobal('fetch', fetchMock);

  render(<Profile />);
  const nameInput = await screen.findByDisplayValue('Marcus Chua');
  fireEvent.change(nameInput, { target: { value: 'Marcus C.' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(screen.getByText('Department: Engineering')).toBeInTheDocument());
});

test('toggles a communication preference checkbox on and off', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleProfile))));
  render(<Profile />);
  await screen.findByDisplayValue('Marcus Chua');

  const smsCheckbox = screen.getByLabelText('sms') as HTMLInputElement;
  expect(smsCheckbox.checked).toBe(false);
  fireEvent.click(smsCheckbox);
  expect(smsCheckbox.checked).toBe(true);

  // sampleProfile already has 'email' checked — toggling it off exercises the
  // "remove from the list" branch, not just "add to the list".
  const emailCheckbox = screen.getByLabelText('email') as HTMLInputElement;
  expect(emailCheckbox.checked).toBe(true);
  fireEvent.click(emailCheckbox);
  expect(emailCheckbox.checked).toBe(false);
});

test('editing the phone field updates the input value', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleProfile))));
  render(<Profile />);
  const phoneInput = await screen.findByDisplayValue('+65 9123 4567');
  fireEvent.change(phoneInput, { target: { value: '+65 8888 8888' } });
  expect(screen.getByDisplayValue('+65 8888 8888')).toBeInTheDocument();
});

test('shows a save error when the PUT request itself fails (network error)', async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(sampleProfile)));
  fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
  vi.stubGlobal('fetch', fetchMock);

  render(<Profile />);
  await screen.findByDisplayValue('Marcus Chua');
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText('Network unavailable')).toBeInTheDocument();
});
