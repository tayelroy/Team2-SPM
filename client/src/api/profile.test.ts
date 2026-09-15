import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { saveSession } from '../auth/session';
import { fetchProfile, updateProfile } from './profile';

const SESSION = { accessToken: 'token-1', user: { userId: 'user-1', email: 'alex@example.com', role: 'Attendee' } };

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('fetchProfile reports signed-out without calling the server when there is no session', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to see your profile.' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('fetchProfile sends the bearer token and returns the profile', async () => {
  saveSession(SESSION);
  const profile = { user_id: 'user-1', name: 'Alex', organisation: null, phone: null, communication_preferences: [] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: true, profile });
  expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
    body: undefined
  });
});

test('fetchProfile maps 401 to a signed-out message', async () => {
  saveSession(SESSION);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 401 })));

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to see your profile.' });
});

test('fetchProfile maps 403 to a role message', async () => {
  saveSession(SESSION);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 })));

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'Your role cannot access a profile.' });
});

test('fetchProfile surfaces the server error and details for other failures', async () => {
  saveSession(SESSION);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid profile details', details: ['name is required.'] }), { status: 400 }))
  );

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'Invalid profile details', details: ['name is required.'] });
});

test('fetchProfile falls back to a status message when the error body is unreadable', async () => {
  saveSession(SESSION);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway unavailable</html>', { status: 502 })));

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'Could not reach your profile (HTTP 502).' });
});

test('fetchProfile reports failure when a success response has no profile', async () => {
  saveSession(SESSION);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'The server did not return a profile.' });
});

test('fetchProfile reports a generic message when the network is unreachable', async () => {
  saveSession(SESSION);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

  const outcome = await fetchProfile();
  expect(outcome).toEqual({ ok: false, message: 'Could not reach the server. Please try again.' });
});

test('updateProfile sends a PUT with the given fields and returns the updated profile', async () => {
  saveSession(SESSION);
  const profile = {
    user_id: 'user-1',
    name: 'Alex Tan',
    organisation: null,
    phone: '+65 8123 4567',
    communication_preferences: ['email']
  };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const input = { name: 'Alex Tan', phone: '+65 8123 4567', communication_preferences: ['email'] };
  const outcome = await updateProfile(input);

  expect(outcome).toEqual({ ok: true, profile });
  expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
    body: JSON.stringify(input)
  });
});

test('updateProfile reports signed-out without calling the server when there is no session', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const outcome = await updateProfile({ name: 'Alex' });
  expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to see your profile.' });
  expect(fetchMock).not.toHaveBeenCalled();
});
