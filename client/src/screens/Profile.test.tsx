import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { saveSession } from '../auth/session';
import Profile from './Profile';

const SESSION = { accessToken: 'token-1', user: { userId: 'user-1', email: 'alex@example.com', role: 'Attendee' } };

const EXTERNAL_PROFILE = {
  user_id: 'user-1',
  name: 'Alex Tan',
  organisation: 'ConnectSphere Test',
  phone: '+65 8123 4567',
  communication_preferences: ['email']
};

const INTERNAL_PROFILE = { ...EXTERNAL_PROFILE, department: 'Facilities' };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Routes GET to the profile fixture and echoes back whatever PUT sends. */
function stubFetch(initialProfile: object) {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init || init.method === 'GET') return jsonResponse({ profile: initialProfile });
    const body = JSON.parse(init.body as string);
    return jsonResponse({ profile: { ...initialProfile, ...body } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  sessionStorage.clear();
  saveSession(SESSION);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('shows a loading state, then the profile once it arrives', async () => {
  stubFetch(EXTERNAL_PROFILE);
  render(<Profile />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your profile…');

  expect(await screen.findByLabelText('Name')).toHaveValue('Alex Tan');
  expect(screen.getByLabelText('Phone')).toHaveValue('+65 8123 4567');
  expect(screen.getByLabelText('Email')).toBeChecked();
  expect(screen.getByLabelText('SMS')).not.toBeChecked();
  expect(screen.getByText('ConnectSphere Test')).toBeInTheDocument();
});

test('shows the load error and no form when the profile cannot be fetched', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 503 })));
  render(<Profile />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach your profile (HTTP 503).');
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
});

test('hides department for an external role (profile has no department key)', async () => {
  stubFetch(EXTERNAL_PROFILE);
  render(<Profile />);
  await screen.findByLabelText('Name');
  expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
});

test('shows department for an internal role and saves it', async () => {
  const fetchMock = stubFetch(INTERNAL_PROFILE);
  render(<Profile />);

  expect(await screen.findByLabelText('Department')).toHaveValue('Facilities');
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Operations' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await screen.findByText('Profile updated.');
  const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(putCall![1].body as string)).toMatchObject({ department: 'Operations' });
});

test('edits name, phone and toggles a communication preference, then saves', async () => {
  const fetchMock = stubFetch(EXTERNAL_PROFILE);
  render(<Profile />);
  await screen.findByLabelText('Name');

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alex T.' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('SMS'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await screen.findByText('Profile updated.');
  const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  const sent = JSON.parse(putCall![1].body as string);
  expect(sent).toEqual({
    name: 'Alex T.',
    phone: null,
    communication_preferences: ['email', 'sms']
  });
  expect(sent.department).toBeUndefined();
});

test('shows server validation details without reporting a successful save', async () => {
  stubFetch(EXTERNAL_PROFILE);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ profile: EXTERNAL_PROFILE }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid profile details', details: ['name is required.'] }, 400))
  );
  render(<Profile />);
  await screen.findByLabelText('Name');

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('name is required.');
  expect(screen.queryByText('Profile updated.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('falls back to placeholders when organisation and phone are unset', async () => {
  stubFetch({ user_id: 'user-1', name: 'Alex Tan', organisation: null, phone: null, communication_preferences: [] });
  render(<Profile />);

  expect(await screen.findByText('—')).toBeInTheDocument();
  expect(screen.getByLabelText('Phone')).toHaveValue('');
});

test('unchecking an already-selected preference removes it', async () => {
  const fetchMock = stubFetch(EXTERNAL_PROFILE);
  render(<Profile />);
  await screen.findByLabelText('Name');

  fireEvent.click(screen.getByLabelText('Email'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await screen.findByText('Profile updated.');
  const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(putCall![1].body as string).communication_preferences).toEqual([]);
});

test('clearing department sends null', async () => {
  const fetchMock = stubFetch(INTERNAL_PROFILE);
  render(<Profile />);
  await screen.findByLabelText('Department');

  fireEvent.change(screen.getByLabelText('Department'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await screen.findByText('Profile updated.');
  const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(putCall![1].body as string).department).toBeNull();
});

test('shows the plain server message when a save failure has no field details', async () => {
  stubFetch(EXTERNAL_PROFILE);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: EXTERNAL_PROFILE }), { status: 200 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
  );
  render(<Profile />);
  await screen.findByLabelText('Name');

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach your profile (HTTP 503).');
});

test('a cancelled StrictMode load cannot overwrite the active profile response', async () => {
  let resolveGet!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveGet = resolve; }))
    .mockResolvedValueOnce(jsonResponse({ profile: { ...EXTERNAL_PROFILE, name: 'Current profile' } })));

  render(<StrictMode><Profile /></StrictMode>);
  expect(await screen.findByLabelText('Name')).toHaveValue('Current profile');
  await act(async () => resolveGet(jsonResponse({ profile: EXTERNAL_PROFILE })));
  expect(screen.getByLabelText('Name')).toHaveValue('Current profile');
});

test('a second click while saving does not submit twice', async () => {
  stubFetch(EXTERNAL_PROFILE);
  render(<Profile />);
  await screen.findByLabelText('Name');

  let resolvePut!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolvePut = resolve; }));
  vi.stubGlobal('fetch', fetchMock);

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const saving = screen.getByRole('button', { name: 'Saving…' });
  fireEvent.click(saving);
  expect(fetchMock).toHaveBeenCalledOnce();
  resolvePut(jsonResponse({ profile: EXTERNAL_PROFILE }));
  await screen.findByText('Profile updated.');
  expect(fetchMock).toHaveBeenCalledOnce();
});
