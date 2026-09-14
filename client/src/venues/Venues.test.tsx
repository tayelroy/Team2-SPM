import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import VenueForm from './VenueForm';
import type { Venue } from './api';

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
    if (url === '/api/venues' && init?.method === 'GET') return Response.json({ venues: rows });
    const creating = url === '/api/venues' && init?.method === 'POST';
    const updating = url === '/api/venues/1' && init?.method === 'PUT';
    if (!creating && !updating) throw new Error(`Unexpected venue request: ${init?.method} ${url}`);
    const saved = { ...JSON.parse(init!.body as string), venue_id: creating ? 2 : 1 };
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
  expect(fetch).toHaveBeenCalledWith('/api/venues', expect.objectContaining({ method: 'POST', cache: 'no-store',
    body: JSON.stringify({ name: 'Harbour Room', location: 'Roof', capacity: 80, facilities: 'Bar',
      accessibility_features: 'Lift', operating_information: 'Every day, 10:00–21:00' }) }));
  unmount();
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Harbour Room' })).toBeInTheDocument();
});

test('editing updates search results and does not duplicate the record', async () => {
  const { fetch, unmount } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fill('Discard this edit');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  for (const [label, value] of Object.entries({ 'Venue name': 'Atrium Hall', Location: 'North Wing', Capacity: 100,
    Facilities: 'Stage', 'Accessibility features': 'Hearing loop', 'Operating information': 'Weekdays, 09:00–18:00' })) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
  }
  fill('Renamed Hall');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('heading', { name: 'Renamed Hall' });
  expect(screen.getByText('1 of 1 venues')).toBeInTheDocument();
  for (const text of ['Roof', '80', 'Bar', 'Lift', 'Every day, 10:00–21:00']) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  for (const query of ['  RENAMED  ', 'roof', 'bar', 'lift', 'every day']) {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
    expect(screen.getByRole('heading', { name: 'Renamed Hall' })).toBeInTheDocument();
  }
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Atrium' } });
  expect(screen.getByRole('heading', { name: 'No matching venues' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('heading', { name: 'Renamed Hall' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/venues/1', expect.objectContaining({ method: 'PUT', body: JSON.stringify({
    name: 'Renamed Hall', location: 'Roof', capacity: 80, facilities: 'Bar', accessibility_features: 'Lift',
    operating_information: 'Every day, 10:00–21:00'
  }) }));
  unmount();
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Renamed Hall' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Atrium Hall' })).not.toBeInTheDocument();
});

test('coordinators can read and use the existing request link but cannot create/edit', async () => {
  const { book } = await open(coordinator);
  for (const text of ['Atrium Hall', 'North Wing', '100', 'Stage', 'Hearing loop', 'Weekdays, 09:00–18:00']) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
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
  const load = deferred(); const fetch = vi.fn((_url: string, _init?: RequestInit) => load.promise); vi.stubGlobal('fetch', fetch);
  const { unmount } = render(<Venues accessToken="token" onBook={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading venue catalogue');
  const signal = fetch.mock.calls[0][1]!.signal!;
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => load.reject(new Error('abort')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    for (const [label, value] of Object.entries({ 'Venue name': 'Harbour Room', Location: 'Roof', Capacity: 80,
      Facilities: 'Bar', 'Accessibility features': 'Lift', 'Operating information': 'Every day, 10:00–21:00' })) {
      expect(screen.getByLabelText(label)).toHaveValue(value);
    }
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
  });

  test('network failures retain unsaved values', async () => {
    const { fetch } = await open(); fetch.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' })); fill();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still in the form');
    expect(screen.getByLabelText('Venue name')).toHaveValue('Harbour Room');
    expect(screen.getByLabelText('Capacity')).toHaveValue(80);
    expect(screen.getByRole('button', { name: 'Create venue' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Harbour Room' })).not.toBeInTheDocument();
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

test('form rejects empty/blank fields, capacity underflow/overflow/fractions and overlong names', () => {
  const onSave = vi.fn();
  render(<VenueForm venue={null} saving={false} error="" onSave={onSave} onCancel={vi.fn()} />);
  const invalidFields = [
    ...['Venue name', 'Location', 'Facilities', 'Accessibility features', 'Operating information']
      .flatMap(label => [[label, ''], [label, ' \n ']]),
    ...['', '0', '-1', '1.5', '2147483648'].map(value => ['Capacity', value]),
    ['Venue name', '🏛'.repeat(256)]
  ];
  for (const [label, value] of invalidFields) {
    fill();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    // Direct submit deliberately bypasses native validation, as a forged submit can.
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('Complete every field');
    expect(onSave).not.toHaveBeenCalled();
  }
});

test('form submits exact inclusive limits, trims every text field and clears validation after correction', () => {
  const onSave = vi.fn();
  render(<VenueForm venue={null} saving={false} error="" onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  for (const [name, capacity] of [['A', 1], ['🏛'.repeat(255), 2147483647]] as const) {
    for (const [label, value] of Object.entries({ 'Venue name': ` ${name} `, Location: ' Roof ', Capacity: String(capacity),
      Facilities: ' Bar ', 'Accessibility features': ' Lift ', 'Operating information': ' Every day ' })) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.submit(screen.getByRole('form'));
    expect(onSave).toHaveBeenLastCalledWith({ name, capacity, location: 'Roof', facilities: 'Bar',
      accessibility_features: 'Lift', operating_information: 'Every day' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
  expect(onSave).toHaveBeenCalledTimes(2);
});

test('existing Supabase records with null fields can be displayed, searched and completed', async () => {
  await open(staff, [{ venue_id: 1, name: 'Legacy hall', location: null, capacity: null,
    facilities: null, accessibility_features: null, operating_information: null }]);
  expect(screen.getAllByText('Not recorded')).toHaveLength(3);
  expect(screen.getByText('Location not recorded')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
  expect(screen.getByRole('heading', { name: 'No matching venues' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Legacy hall' }));
  expect(screen.getByLabelText('Capacity')).toHaveValue(null);
  expect(screen.getByLabelText('Facilities')).toHaveValue('');
  fill('Legacy hall');
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByRole('status')).toHaveTextContent('Legacy hall saved');
  expect(screen.getByText('80')).toBeInTheDocument();
  expect(screen.queryByText('Not recorded')).not.toBeInTheDocument();
});
