import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import type { Venue } from './api';
import type { VenueOperations } from './operationsApi';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays, 09:00–18:00' };
const staff = { userId: 'staff', role: 'venue_staff',
  permissions: ['venues.read', 'venues.create', 'venues.update', 'venues.operations.read', 'venues.operations.update'] };
const coordinator = { userId: 'coordinator', role: 'event_coordinator', permissions: ['venues.read', 'venues.operations.read'] };
const recorded: VenueOperations = {
  setup_minutes: 30, turnaround_minutes: 45, emergency_access: 'Two exits to the car park',
  known_restrictions: 'No open flames', updated_at: '2026-10-05T02:00:00.000Z'
};
const blank: VenueOperations = { setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function api(identity: typeof staff | typeof coordinator, operations: VenueOperations | number = blank, saveStatus = 200) {
  let current = typeof operations === 'number' ? blank : structuredClone(operations);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(identity);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues/1' && init?.method === 'PUT') return Response.json({ venue: { ...venue, ...JSON.parse(init.body as string) } });
    if (url === '/api/venues/1/operations' && (!init?.method || init.method === 'GET')) {
      return typeof operations === 'number' ? new Response('', { status: operations }) : Response.json({ operations: current });
    }
    if (url === '/api/venues/1/operations' && init?.method === 'PUT') {
      if (saveStatus !== 200) return Response.json({ error: 'refused' }, { status: saveStatus });
      current = { ...JSON.parse(init.body as string), updated_at: '2026-10-05T03:00:00.000Z' };
      return Response.json({ operations: current });
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function open(identity: typeof staff | typeof coordinator, operations: VenueOperations | number = blank, saveStatus = 200) {
  const fetch = api(identity, operations, saveStatus);
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await screen.findByRole('searchbox');
  return fetch;
}

const fact = (label: string) => screen.getByText(label).nextSibling;
const operationPuts = (fetch: ReturnType<typeof api>) =>
  fetch.mock.calls.filter(([url, init]) => url === '/api/venues/1/operations' && init?.method === 'PUT');

test('[NORMAL] [SG2-77:AC1] [SG2-77:AC5] setup, turnaround and safety details show on the venue\'s details', async () => {
  await open(staff, recorded);
  expect(fact('Setup and turnaround')).toHaveTextContent('30 min setup · 45 min turnaround');
  expect(fact('Emergency access')).toHaveTextContent('Two exits to the car park');
  expect(fact('Known restrictions')).toHaveTextContent('No open flames');
});

test('[BOUNDARY] [SG2-77:AC3] [SG2-77:AC5] a venue with nothing saved shows 0 minutes and "Not recorded"', async () => {
  await open(staff, blank);
  expect(fact('Setup and turnaround')).toHaveTextContent('0 min setup · 0 min turnaround');
  expect(fact('Emergency access')).toHaveTextContent('Not recorded');
  expect(fact('Known restrictions')).toHaveTextContent('Not recorded');
});

test('[FAILURE] [SG2-77:AC3] [SG2-77:AC6] a failed read shows "Unavailable" and the form cannot overwrite the saved values', async () => {
  const fetch = await open(staff, 503);
  expect(fact('Setup and turnaround')).toHaveTextContent('Unavailable');
  expect(fact('Emergency access')).toHaveTextContent('Unavailable');
  expect(fact('Known restrictions')).toHaveTextContent('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.queryByLabelText('Setup time (minutes)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Atrium Hall saved. The catalogue is up to date.');
  expect(operationPuts(fetch)).toHaveLength(0);
});

test('[CONFLICT] [SG2-77:AC1] [SG2-77:AC6] saving twice in quick succession sends one venue save and one times save', async () => {
  const fetch = await open(staff, recorded);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  const form = screen.getByRole('form', { name: 'Edit venue' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Atrium Hall saved. The catalogue is up to date.');
  expect(fetch.mock.calls.filter(([url, init]) => url === '/api/venues/1' && init?.method === 'PUT')).toHaveLength(1);
  expect(operationPuts(fetch)).toHaveLength(1);
});

test('[FAILURE] [SG2-77:AC6] coordinators see the times but get no controls to change them', async () => {
  await open(coordinator, recorded);
  expect(fact('Setup and turnaround')).toHaveTextContent('30 min setup · 45 min turnaround');
  expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-77:AC1] [SG2-77:AC2] [SG2-77:AC5] Venue Staff edit the times and safety details in the venue form and save them', async () => {
  const fetch = await open(staff, recorded);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.getByLabelText('Setup time (minutes)')).toHaveValue(30);
  fireEvent.change(screen.getByLabelText('Turnaround time (minutes)'), { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText('Known restrictions'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Atrium Hall saved. The catalogue is up to date.');
  expect(JSON.parse(String(operationPuts(fetch)[0][1]?.body))).toEqual({
    setup_minutes: 30, turnaround_minutes: 60, emergency_access: 'Two exits to the car park', known_restrictions: null
  });
  expect(fact('Setup and turnaround')).toHaveTextContent('30 min setup · 60 min turnaround');
  expect(fact('Known restrictions')).toHaveTextContent('Not recorded');
});

test('[BOUNDARY] [SG2-77:AC4] negative, fractional and over-limit minutes are refused in the form without saving', async () => {
  const fetch = await open(staff, recorded);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  for (const value of ['-1', '1441', '2.5', '']) {
    fireEvent.change(screen.getByLabelText('Setup time (minutes)'), { target: { value } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit venue' }));
    expect(await screen.findByText(/whole minutes from 0 to 1440/)).toBeInTheDocument();
  }
  fireEvent.change(screen.getByLabelText('Setup time (minutes)'), { target: { value: '1440' } });
  fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value: 'x'.repeat(2001) } });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit venue' }));
  expect(await screen.findByText(/within 2000 characters/)).toBeInTheDocument();
  expect(operationPuts(fetch)).toHaveLength(0);
});

test('[FAILURE] [SG2-77:AC6] a save refused by the server explains why and hides the catalogue when access is lost', async () => {
  await open(staff, recorded, 403);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You no longer have permission to do this.');
  await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument());
});

test('[FAILURE] [SG2-77:AC4] a save the server rejects as invalid keeps the form open with the reason', async () => {
  await open(staff, recorded, 400);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText(/whole minutes from 0 to 1440/)).toBeInTheDocument();
  expect(screen.getByLabelText('Setup time (minutes)')).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-77:AC3] a newly created venue shows the defaults and saves blank safety notes as not recorded', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(staff);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [] });
    if (url === '/api/venues' && init?.method === 'POST') return Response.json({ venue: { ...JSON.parse(init.body as string), venue_id: 9 } });
    if (url === '/api/venues/9' && init?.method === 'PUT') return Response.json({ venue: { ...venue, venue_id: 9, ...JSON.parse(init.body as string) } });
    if (url === '/api/venues/9/operations' && init?.method === 'PUT') return Response.json({ operations: { ...JSON.parse(init.body as string), updated_at: null } });
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
  expect(screen.queryByLabelText('Setup time (minutes)')).not.toBeInTheDocument();
  for (const [label, value] of Object.entries({ 'Venue name': 'New Room', Location: 'Level 3', Capacity: '40',
    Facilities: 'Screen', 'Accessibility features': 'Lift', 'Operating information': 'Daily' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));
  await screen.findByText('New Room saved. The catalogue is up to date.');
  expect(fact('Setup and turnaround')).toHaveTextContent('0 min setup · 0 min turnaround');
  expect(fact('Emergency access')).toHaveTextContent('Not recorded');
  fireEvent.click(screen.getByRole('button', { name: 'Edit New Room' }));
  expect(screen.getByLabelText('Setup time (minutes)')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('New Room saved. The catalogue is up to date.');
  const put = fetch.mock.calls.find(([url, init]) => url === '/api/venues/9/operations' && init?.method === 'PUT');
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null });
});

test('[CONFLICT] [SG2-77:AC6] leaving the page while the times are saving discards the late response', async () => {
  let release!: (response: Response) => void;
  const fetch = api(staff, recorded);
  fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(staff);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues/1' && init?.method === 'PUT') return Response.json({ venue });
    if (url === '/api/venues/1/operations' && init?.method === 'PUT') return new Promise<Response>(resolve => { release = resolve; });
    return Response.json({ operations: recorded });
  });
  const view = render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(operationPuts(fetch)).toHaveLength(1));
  view.unmount();
  release(Response.json({ operations: recorded }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(screen.queryByText(/saved/)).not.toBeInTheDocument();
});
