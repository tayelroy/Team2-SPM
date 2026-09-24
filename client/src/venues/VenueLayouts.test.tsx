import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import type { Venue } from './api';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays, 09:00–18:00' };
const staff = { userId: 'staff', role: 'venue_staff',
  permissions: ['venues.read', 'venues.create', 'venues.update', 'venues.layouts.read', 'venues.layouts.update'] };
const coordinator = { userId: 'coordinator', role: 'event_coordinator', permissions: ['venues.read', 'venues.layouts.read'] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type LayoutRow = { layout: string; other_description: string | null };

function api(identity = staff, layouts: LayoutRow[] = []) {
  let rows = structuredClone(layouts);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(identity);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues' && init?.method === 'POST') return Response.json({ venue: { ...JSON.parse(init.body as string), venue_id: 2 } });
    if (url === '/api/venues/1' && init?.method === 'PUT') return Response.json({ venue: { ...venue, ...JSON.parse(init.body as string) } });
    if (url === '/api/venues/1/layouts' && (!init?.method || init.method === 'GET')) return Response.json({ layouts: rows });
    if (url === '/api/venues/1/layouts' && init?.method === 'PUT') {
      rows = JSON.parse(init.body as string).layouts.map((item: LayoutRow) => ({ layout: item.layout, other_description: item.other_description ?? null }));
      return Response.json({ layouts: rows });
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, rows: () => rows };
}

async function open(identity = staff, layouts: LayoutRow[] = []) {
  const helpers = api(identity, layouts);
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await screen.findByRole('searchbox');
  return helpers;
}

function fillVenueFields(name = 'Atrium Hall') {
  for (const [label, value] of Object.entries({ 'Venue name': name, Location: 'North Wing', Capacity: '100',
    Facilities: 'Stage', 'Accessibility features': 'Hearing loop', 'Operating information': 'Weekdays, 09:00–18:00' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

test('AC2: supported layouts are shown on the venue\'s details as soon as the catalogue loads, with no per-card loading state', async () => {
  await open(staff, [{ layout: 'classroom', other_description: null }]);
  expect(screen.getByText('Classroom')).toBeInTheDocument();
  expect(screen.queryByText(/Loading…/)).not.toBeInTheDocument();
});

test('a venue with no recorded layouts shows "NA"', async () => {
  await open(staff, []);
  expect(screen.getByText('Supported layouts').nextSibling).toHaveTextContent('NA');
});

test('a failed layouts read for one venue does not block the catalogue; that venue falls back to "NA"', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(staff);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues/1/layouts' && (!init?.method || init.method === 'GET')) return new Response('', { status: 503 });
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await screen.findByRole('searchbox');
  expect(screen.getByText('Supported layouts').nextSibling).toHaveTextContent('NA');
});

test('coordinators can see supported layouts but have no controls to manage them', async () => {
  await open(coordinator, [{ layout: 'banquet', other_description: null }]);
  expect(await screen.findByText('Banquet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
});

test('AC1: venue staff edit details and supported layouts together in one form and submit', async () => {
  const { fetch } = await open(staff, [{ layout: 'classroom', other_description: null }]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.getByRole('heading', { name: 'Edit venue' })).toBeInTheDocument();
  expect(screen.getByText('Supported layouts')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Classroom' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Classroom' })); // uncheck…
  expect(screen.getByRole('checkbox', { name: 'Classroom' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Classroom' })); // …and recheck it
  expect(screen.getByRole('checkbox', { name: 'Classroom' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Theatre' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
  fireEvent.change(screen.getByLabelText('Describe the other layout'), { target: { value: 'U-shape with side tables' } });
  fillVenueFields();
  fireEvent.submit(screen.getByRole('form'));
  expect(await screen.findByRole('status')).toHaveTextContent('Atrium Hall saved');
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/layouts', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ layouts: [
      { layout: 'classroom' }, { layout: 'theatre' }, { layout: 'other', other_description: 'U-shape with side tables' }
    ] })
  }));
  expect(screen.getByText('Classroom, Theatre, U-shape with side tables')).toBeInTheDocument();
});

test('creating a new venue has no layouts section, since there is no venue id yet', async () => {
  await open(staff, []);
  fireEvent.click(screen.getByRole('button', { name: 'Add venue' }));
  expect(screen.getByRole('heading', { name: 'Add venue' })).toBeInTheDocument();
  expect(screen.queryByText('Supported layouts')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('"Other" cannot be submitted without a description', async () => {
  await open(staff, []);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByRole('alert')).toHaveTextContent('255 characters or fewer');
});

test('cancel leaves the record untouched', async () => {
  const { fetch } = await open(staff, []);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Theatre' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalledWith('/api/venues/1/layouts', expect.objectContaining({ method: 'PUT' }));
});

test('a caller who can edit venue details but not layouts sees the venue form without the layouts section', async () => {
  const identity = { userId: 'staff', role: 'venue_staff', permissions: ['venues.read', 'venues.create', 'venues.update'] };
  await open(identity, []);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.queryByText('Supported layouts')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('a newly created venue has no layouts entry yet; the catalogue and edit form fall back to empty without fetching it', async () => {
  const { fetch } = await open(staff, []);
  fireEvent.click(screen.getByRole('button', { name: 'Add venue' }));
  for (const [label, value] of Object.entries({ 'Venue name': 'Harbour Room', Location: 'Roof', Capacity: '80',
    Facilities: 'Bar', 'Accessibility features': 'Lift', 'Operating information': 'Every day' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.submit(screen.getByRole('form'));
  await screen.findByRole('heading', { name: 'Harbour Room' });
  expect(fetch).not.toHaveBeenCalledWith('/api/venues/2/layouts', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Edit Harbour Room' }));
  for (const layoutLabel of ['Classroom', 'Theatre', 'Boardroom', 'Banquet', 'Exhibition', 'Other']) {
    expect(screen.getByRole('checkbox', { name: layoutLabel })).not.toBeChecked();
  }
});

test('aborting while layouts are loading for the catalogue discards the stale response', async () => {
  let resolveLayouts!: (value: Response) => void;
  const layoutsPromise = new Promise<Response>(resolve => { resolveLayouts = resolve; });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(staff);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues/1/layouts' && (!init?.method || init.method === 'GET')) return layoutsPromise;
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/venues/1/layouts', expect.anything()));
  rerender(<Venues accessToken={null} onBook={vi.fn()} />);
  await act(async () => resolveLayouts(Response.json({ layouts: [] })));
  expect(screen.queryByText('Atrium Hall')).not.toBeInTheDocument();
});

test('leaving mid-save after venue details succeed but before layouts finish aborts the layouts step', async () => {
  let resolveLayoutsSave!: (value: Response) => void;
  const layoutsSavePromise = new Promise<Response>(resolve => { resolveLayoutsSave = resolve; });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json(staff);
    if (url === '/api/venues' && (!init?.method || init.method === 'GET')) return Response.json({ venues: [venue] });
    if (url === '/api/venues/1/layouts' && (!init?.method || init.method === 'GET')) return Response.json({ layouts: [{ layout: 'classroom', other_description: null }] });
    if (url === '/api/venues/1' && init?.method === 'PUT') return Response.json({ venue: { ...venue, ...JSON.parse(init.body as string) } });
    if (url === '/api/venues/1/layouts' && init?.method === 'PUT') return layoutsSavePromise;
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await screen.findByRole('searchbox');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Atrium Hall' }));
  fillVenueFields();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Theatre' }));
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/venues/1/layouts', expect.objectContaining({ method: 'PUT' })));
  rerender(<Venues accessToken={null} onBook={vi.fn()} />);
  await act(async () => resolveLayoutsSave(Response.json({ layouts: [] })));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
