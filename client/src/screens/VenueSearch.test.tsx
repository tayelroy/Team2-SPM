import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import VenueSearch, { describeCriteria } from './VenueSearch';
import { EMPTY_SEARCH, type VenueMatch } from '../venues/searchApi';
import type { VenueSearchPrefill } from '../venues/searchPrefill';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const terrace: VenueMatch = { venue_id: 3, name: 'Rooftop Terrace', location: 'Level 12', capacity: 125,
  facilities: 'Bar, outdoor power', accessibility_features: 'Lift access', operating_information: 'Daily',
  layouts: [{ layout: 'banquet', other_description: null }],
  held: [{ starts_at: '2030-06-15T13:00:00.000Z', ends_at: '2030-06-15T16:00:00.000Z' }] };
const bare: VenueMatch = { venue_id: 4, name: 'Unrecorded Room', location: null, capacity: null, facilities: null,
  accessibility_features: null, operating_information: null, layouts: [], held: [] };

const prefill: VenueSearchPrefill = { eventId: 10, eventName: 'Meridian Forum', accessibilityNeeds: 'Step-free access to the stage',
  values: { ...EMPTY_SEARCH, from: '2030-06-15T00:00', until: '2030-06-15T23:59', attendance: '180', accessibility: 'step-free' } };

function stubSearch(respond: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => respond());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function query(fetch: ReturnType<typeof stubSearch>, call = 0) {
  return Object.fromEntries(new URL(fetch.mock.calls[call][0], 'http://local').searchParams);
}

function fill(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('[NORMAL] [SG2-46:AC2] describeCriteria lists every applied criterion in one line', () => {
  expect(describeCriteria({ from: '2030-06-15T00:00', until: '2030-06-15T23:59', attendance: '80', location: 'North',
    layout: 'theatre', facilities: 'stage', accessibility: 'step-free' })).toBe(
    '15 Jun 2030, 12:00 am – 15 Jun 2030, 11:59 pm · 80+ people · Location: North · Layout: Theatre · Facilities: stage · Accessibility: step-free');
  expect(describeCriteria({ ...EMPTY_SEARCH, from: '2030-06-15T00:00', until: '2030-06-15T23:59' }))
    .toBe('15 Jun 2030, 12:00 am – 15 Jun 2030, 11:59 pm');
});

test('[NORMAL] [SG2-46:AC2] AC2: a manual search sends every criterion and lists matching venues with held bookings flagged', async () => {
  const fetch = stubSearch(() => Response.json({ venues: [terrace, bare] }));
  render(<VenueSearch accessToken="token" />);
  expect(screen.getByText('Search venues')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00', Attendance: '100',
    Layout: 'banquet', Location: 'Level', Facilities: 'bar', Accessibility: 'lift' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(screen.getByRole('status')).toHaveTextContent('Searching venues…');
  expect(await screen.findByText(/2 venues available/)).toBeInTheDocument();
  expect(query(fetch)).toEqual({ from: '2030-06-15T01:00:00.000Z', to: '2030-06-15T09:00:00.000Z', attendance: '100',
    layout: 'banquet', location: 'Level', facilities: 'bar', accessibility: 'lift' });
  expect(screen.getByRole('heading', { name: 'Rooftop Terrace' })).toBeInTheDocument();
  expect(screen.getByText('Banquet', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('⚠ Held booking 15 Jun 2030, 9:00 pm – 16 Jun 2030, 12:00 am (not confirmed)')).toBeInTheDocument();
  expect(screen.getByText('Location not recorded')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
});

test('[BOUNDARY] [SG2-46:AC2] a single match is counted in the singular', async () => {
  stubSearch(() => Response.json({ venues: [bare] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByText(/^1 venue available/)).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-46:AC4] AC4: when nothing matches it says so and shows the criteria searched', async () => {
  stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00', Attendance: '500' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByRole('heading', { name: 'No venues match' })).toBeInTheDocument();
  expect(screen.getByText(/^Searched: .* · 500\+ people$/)).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-46:AC2] a missing or backwards period is caught before searching', async () => {
  const fetch = stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" />);
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(screen.getByRole('alert')).toHaveTextContent('starts before it ends');
  fill({ 'From (Singapore time)': '2030-06-15T09:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  fill({ 'Until (Singapore time)': '2030-06-15T09:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-46:AC2] server refusals and network failures are reported, and Clear resets the search', async () => {
  stubSearch(() => Response.json({ error: 'Nope' }, { status: 403 }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only Event Coordinators can search venues.');
  stubSearch(() => { throw new TypeError('Failed to fetch'); });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue search is unavailable right now.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('From (Singapore time)')).toHaveValue('');
});

test('[NORMAL] [SG2-46:AC1] AC1: opened from an approved event, the criteria are pre-filled and the search runs straight away', async () => {
  const fetch = stubSearch(() => Response.json({ venues: [terrace] }));
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  expect(screen.getByText('For: Meridian Forum (#10)')).toBeInTheDocument();
  expect(screen.getByLabelText('Attendance')).toHaveValue(180);
  expect(screen.getByLabelText('Accessibility')).toHaveValue('step-free');
  expect(screen.getByText(/The event's accessibility needs: “Step-free access to the stage”/)).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Rooftop Terrace' })).toBeInTheDocument();
  expect(query(fetch)).toMatchObject({ attendance: '180', accessibility: 'step-free' });
});

test('[NORMAL] [SG2-47:AC1] after searching for an event, venues that do not fit it are listed with the reason', async () => {
  const small = { venue_id: 2, name: 'Seminar Room', location: null, capacity: 60,
    suitability: { suitable: false, issues: [{ kind: 'capacity', message: "Expected attendance of 180 is above this venue's capacity of 60." }] } };
  const fetch = vi.fn(async (url: string) => url.startsWith('/api/venues/suitability')
    ? Response.json({ venues: [small] }) : Response.json({ venues: [terrace] }));
  vi.stubGlobal('fetch', fetch);
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  expect(await screen.findByRole('heading', { name: '1 of 1 venues do not fit Meridian Forum' })).toBeInTheDocument();
  expect(screen.getByText("Expected attendance of 180 is above this venue's capacity of 60.")).toBeInTheDocument();
  expect(fetch.mock.calls.map(call => call[0])).toContain('/api/venues/suitability?event_id=10');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByRole('region', { name: 'Venues that do not fit Meridian Forum' })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-47:AC1] a manual search does not check venues against any event', async () => {
  const fetch = stubSearch(() => Response.json({ venues: [terrace] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('heading', { name: 'Rooftop Terrace' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('[NORMAL] [SG2-46:AC3] AC3: an event without accessibility needs says accessibility is not used to match', async () => {
  stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" prefill={{ ...prefill, accessibilityNeeds: null, values: { ...prefill.values, accessibility: '' } }} />);
  expect(screen.getByText(/No accessibility needs were specified for this event/)).toBeInTheDocument();
  await screen.findByRole('heading', { name: 'No venues match' });
});

test('[BOUNDARY] [SG2-46:AC1] an event without a date is pre-filled but not searched until the period is entered', () => {
  const fetch = stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" prefill={{ ...prefill, values: { ...prefill.values, from: '', until: '' } }} />);
  expect(fetch).not.toHaveBeenCalled();
});

function abortable(_url: string, init?: RequestInit) {
  return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
}

test('[CONFLICT] [SG2-46:search-supersession] a newer search supersedes one still running, and leaving aborts it', async () => {
  let call = 0;
  const fetch = vi.fn((url: string, init?: RequestInit) => call++ === 0 ? abortable(url, init) : Promise.resolve(Response.json({ venues: [bare] })));
  vi.stubGlobal('fetch', fetch);
  const { unmount } = render(<VenueSearch accessToken="token" prefill={prefill} />);
  expect(screen.getByRole('status')).toHaveTextContent('Searching venues…');
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByRole('heading', { name: 'Unrecorded Room' })).toBeInTheDocument();
  expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  vi.stubGlobal('fetch', vi.fn(abortable));
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  unmount();
  await act(async () => {});
});
