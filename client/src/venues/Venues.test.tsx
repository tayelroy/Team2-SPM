import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import VenueForm from './VenueForm';
import { venueRequest, type Venue } from './api';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays, 09:00–18:00' };
const staff = { userId: 'staff', role: 'venue_staff', permissions: ['venues.read', 'venues.create', 'venues.update'] };
const coordinator = { userId: 'coordinator', role: 'event_coordinator', permissions: ['venues.read'] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function api(identity = staff, initial = [venue]) {
  let rows = structuredClone(initial);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    if (url === '/api/auth/me') return Response.json(identity);
    if (init?.method === 'GET') return Response.json({ venues: rows });
    const saved = { ...JSON.parse(init!.body as string), venue_id: init?.method === 'POST' ? 2 : 1 };
    rows = [...rows.filter(row => row.venue_id !== saved.venue_id), saved];
    return Response.json({ venue: saved });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function open(identity = staff, initial = [venue]) {
  const fetch = api(identity, initial);
  const book = vi.fn();
  const view = render(<Venues accessToken="test-token" onBook={book} />);
  await screen.findByRole('searchbox');
  return { fetch, book, ...view };
}
function fill(name = 'Harbour Room') {
  for (const [label, value] of Object.entries({ 'Venue name': name, Location: 'Roof', Capacity: '80', Facilities: 'Bar',
    'Accessibility features': 'Lift', 'Operating information': 'Every day, 10:00–21:00' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('no token never loads data or exposes write controls', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<Venues onBook={vi.fn()} />);
  expect(screen.getByText(/Sign in with your account/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Add venue' })).not.toBeInTheDocument();
});

test('staff creates a venue, searches its saved fields and reloads it from the API', async () => {
  const { fetch, unmount } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Add venue' }));
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Harbour Room saved');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'roof' } });
  expect(screen.getByRole('heading', { name: 'Harbour Room' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Atrium Hall' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/venues', expect.objectContaining({ method: 'POST', cache: 'no-store' }));
  unmount();
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Harbour Room' })).toBeInTheDocument();
});

test('editing updates search results and does not duplicate the record', async () => {
  const { fetch } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.getByLabelText('Capacity')).toHaveValue(100);
  fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'Renamed Hall' } });
  fireEvent.change(screen.getByLabelText('Facilities'), { target: { value: 'Piano' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('heading', { name: 'Renamed Hall' });
  expect(screen.getByText('1 of 1 venues')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'piano' } });
  expect(screen.getByRole('heading', { name: 'Renamed Hall' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Atrium' } });
  expect(screen.getByRole('heading', { name: 'No matching venues' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('heading', { name: 'Renamed Hall' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/venues/1', expect.objectContaining({ method: 'PUT' }));
});

test('coordinators can read and use the existing request link but cannot create/edit', async () => {
  const { book } = await open(coordinator);
  expect(screen.queryByRole('button', { name: /Edit Atrium/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add venue' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request Atrium Hall' }));
  expect(book).toHaveBeenCalledOnce();
});

test('cancel discards an unsaved form and the empty state explains there are no venues', async () => {
  const { fetch } = await open(staff, []);
  expect(screen.getByRole('heading', { name: 'No venues yet' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add venue' }));
  fill(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Add venue' }));
  expect(screen.getByLabelText('Venue name')).toHaveValue('');
});

test('unauthorized roles cannot reach the venue API', async () => {
  const fetch = api({ userId: 'attendee', role: 'attendee', permissions: [] });
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('permission');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('network failure offers retry and recovers', async () => {
  const fetch = api(); fetch.mockRejectedValueOnce(new Error('offline'));
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load venues');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
});

test('shows loading and ignores a rejected request after unmount', async () => {
  const load = deferred(); vi.stubGlobal('fetch', vi.fn(() => load.promise));
  const { unmount } = render(<Venues accessToken="token" onBook={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading venue catalogue');
  unmount();
  await act(async () => load.reject(new Error('abort')));
});

test('a stale successful load cannot restore another user’s catalogue', async () => {
  const fetch = api(); const load = deferred();
  fetch.mockResolvedValueOnce(Response.json(staff)).mockImplementationOnce(() => load.promise);
  const { rerender } = render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  rerender(<Venues accessToken={null} onBook={vi.fn()} />);
  await act(async () => load.resolve(Response.json({ venues: [venue] })));
  expect(screen.queryByText('Atrium Hall')).not.toBeInTheDocument();
});

describe('saving', () => {
  test('deduplicates submissions and disables the form while awaiting a save', async () => {
    const { fetch } = await open(); const save = deferred(); fetch.mockImplementationOnce(() => save.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' })); fill();
    act(() => {
      fireEvent.submit(screen.getByRole('form'));
      fireEvent.submit(screen.getByRole('form'));
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Venue name')).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => save.resolve(Response.json({ venue: { ...venue, name: 'Harbour Room' } })));
    expect(screen.getByRole('status')).toHaveTextContent('saved');
  });

  for (const [status, message] of [
    [400, 'Check the venue details and capacity, then try again.'],
    [404, 'This venue is no longer available. Reload the catalogue.'],
    [503, 'Unable to reach the venue service. Please try again.']
  ] as const) test(`a ${status} save error retains edits for retry`, async () => {
    const { fetch } = await open(); fetch.mockResolvedValueOnce(Response.json({}, { status }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' })); fill();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Venue name')).toHaveValue('Harbour Room');
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
  });

  test('network failures retain unsaved values', async () => {
    const { fetch } = await open(); fetch.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' })); fill();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still in the form');
  });

  for (const [status, message] of [
    [401, 'Your session has expired. Sign in again.'],
    [403, 'You no longer have permission to do this.']
  ] as const) test(`a ${status} write denial removes controls and stale data`, async () => {
    const { fetch } = await open(); fetch.mockResolvedValueOnce(Response.json({}, { status }));
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' })); fill();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByText('Atrium Hall')).not.toBeInTheDocument();
  });

  for (const succeeds of [true, false]) test(`leaving during a save aborts it, ignoring late ${succeeds ? 'success' : 'failure'}`, async () => {
    const { fetch, rerender } = await open(); const save = deferred(); fetch.mockImplementationOnce(() => save.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' })); fill(); fireEvent.submit(screen.getByRole('form'));
    const init = fetch.mock.calls[2][1]!;
    rerender(<Venues accessToken={null} onBook={vi.fn()} />);
    expect(init.signal!.aborted).toBe(true);
    await act(async () => succeeds ? save.resolve(Response.json({ venue })) : save.reject(new Error('aborted')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

test('form validates whitespace and capacity boundaries even when native validation is bypassed', () => {
  const onSave = vi.fn();
  render(<VenueForm venue={null} saving={false} error="" onSave={onSave} onCancel={vi.fn()} />);
  fill();
  for (const capacity of ['0', '-1', '1.5', '2147483648']) {
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: capacity } });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('positive whole-number');
  }
  fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: '   ' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: ' Roof ' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ capacity: 1, location: 'Roof' }));
});

test('GET venue errors use the same safe messages as writes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
  await expect(venueRequest('token', new AbortController().signal)).rejects.toThrow('session has expired');
});

test('existing Supabase records with null fields can be displayed, searched and completed', async () => {
  await open(staff, [{ venue_id: 1, name: 'Legacy hall', location: null, capacity: null,
    facilities: null, accessibility_features: null, operating_information: null }]);
  expect(screen.getAllByText('Not recorded')).toHaveLength(3);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
  expect(screen.getByRole('heading', { name: 'No matching venues' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Legacy hall' }));
  expect(screen.getByLabelText('Capacity')).toHaveValue(null);
  expect(screen.getByLabelText('Facilities')).toHaveValue('');
  fill('a'.repeat(256));
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByRole('alert')).toHaveTextContent('255 characters');
  fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'Legacy hall' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByRole('status')).toHaveTextContent('Legacy hall saved');
});
