import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import VenueSearch, { describeCriteria } from './VenueSearch';
import { EMPTY_SEARCH, formatSgt, type VenueMatch } from '../venues/searchApi';
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

test('describeCriteria lists every applied criterion in one line', () => {
  expect(describeCriteria({ from: '2030-06-15T00:00', until: '2030-06-15T23:59', attendance: '80', location: 'North',
    layout: 'theatre', facilities: 'stage', accessibility: 'step-free' })).toBe(
    `${formatSgt('2030-06-14T16:00:00.000Z')} – ${formatSgt('2030-06-15T15:59:00.000Z')} · 80+ people · Location: North · Layout: Theatre · Facilities: stage · Accessibility: step-free`);
  expect(describeCriteria({ ...EMPTY_SEARCH, from: '2030-06-15T00:00', until: '2030-06-15T23:59' }))
    .toBe(`${formatSgt('2030-06-14T16:00:00.000Z')} – ${formatSgt('2030-06-15T15:59:00.000Z')}`);
});

test('AC2: a manual search sends every criterion and lists matching venues with held bookings flagged', async () => {
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
  expect(screen.getByText(`⚠ Held booking ${formatSgt(terrace.held[0].starts_at)} – ${formatSgt(terrace.held[0].ends_at)} (not confirmed)`)).toBeInTheDocument();
  expect(screen.getByText('Location not recorded')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
});

test('a single match is counted in the singular', async () => {
  stubSearch(() => Response.json({ venues: [bare] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByText(/^1 venue available/)).toBeInTheDocument();
});

test('AC4: when nothing matches it says so and shows the criteria searched', async () => {
  stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00', Attendance: '500' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await screen.findByRole('heading', { name: 'No venues match' })).toBeInTheDocument();
  expect(screen.getByText(/^Searched: .* · 500\+ people$/)).toBeInTheDocument();
});

test('a missing or backwards period is caught before searching', async () => {
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

test('server refusals and network failures are reported, and Clear resets the search', async () => {
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

test('AC1: opened from an approved event, the criteria are pre-filled and the search runs straight away', async () => {
  const fetch = stubSearch(() => Response.json({ venues: [terrace] }));
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  expect(screen.getByText('For: Meridian Forum (#10)')).toBeInTheDocument();
  expect(screen.getByLabelText('Attendance')).toHaveValue(180);
  expect(screen.getByLabelText('Accessibility')).toHaveValue('step-free');
  expect(screen.getByText(/The event's accessibility needs: “Step-free access to the stage”/)).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Rooftop Terrace' })).toBeInTheDocument();
  expect(query(fetch)).toMatchObject({ attendance: '180', accessibility: 'step-free' });
});

test('AC3: an event without accessibility needs says accessibility is not used to match', async () => {
  stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" prefill={{ ...prefill, accessibilityNeeds: null, values: { ...prefill.values, accessibility: '' } }} />);
  expect(screen.getByText(/No accessibility needs were specified for this event/)).toBeInTheDocument();
  await screen.findByRole('heading', { name: 'No venues match' });
});

test('an event without a date is pre-filled but not searched until the period is entered', () => {
  const fetch = stubSearch(() => Response.json({ venues: [] }));
  render(<VenueSearch accessToken="token" prefill={{ ...prefill, values: { ...prefill.values, from: '', until: '' } }} />);
  expect(fetch).not.toHaveBeenCalled();
});

function abortable(_url: string, init?: RequestInit) {
  return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
}

test('a newer search supersedes one still running, and leaving aborts it', async () => {
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
