import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const prefill: VenueSearchPrefill = { eventId: 10, eventName: 'Meridian Forum', accessibilityNeeds: 'Step-free access to the stage', venueRequirements: 'A bar',
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
  const fetch = stubSearch(() => Response.json({ venues: [] }));
  const hint = 'No accessibility needs were specified for this event. Add Accessibility keywords if you want to narrow the matches.';
  render(<VenueSearch accessToken="token" prefill={{ ...prefill, accessibilityNeeds: null, values: { ...prefill.values, accessibility: '' } }} />);
  expect(screen.getByLabelText('Accessibility')).toHaveValue('');
  expect(screen.getByText(hint)).toBeInTheDocument();
  await screen.findByRole('heading', { name: 'No venues match' });
  const searches = () => fetch.mock.calls.filter(([url]) => url.startsWith('/api/venues/search?'));
  expect(new URL(searches()[0][0], 'http://local').searchParams.has('accessibility')).toBe(false);
  fill({ Accessibility: 'ramp' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('heading', { name: 'No venues match' });
  expect(searches()).toHaveLength(2);
  expect(new URL(searches()[1][0], 'http://local').searchParams.get('accessibility')).toBe('ramp');
  expect(screen.getByLabelText('Accessibility')).toHaveValue('ramp');
  expect(screen.getByText(hint)).toBeInTheDocument();
  expect(screen.getByText(/^Searched: .*Accessibility: ramp$/)).toBeInTheDocument();
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

const requested = { request_id: 41, event_id: 10, venue_id: 3, venue_name: 'Rooftop Terrace', status: 'pending',
  starts_at: '2030-06-14T16:00:00.000Z', ends_at: '2030-06-15T15:59:00.000Z', layout: 'banquet',
  venue_requirements: 'A bar', requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z', decider_name: null, decided_at: null, decision_reason: null, withdrawer_name: null, withdrawn_at: null };

/** The venue search, suitability and venue request endpoints, as a coordinator sees them. */
function stubEventSearch(booking = 'allowed') {
  const made: unknown[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venues/suitability')) return Response.json({ venues: [] });
    if (url.startsWith('/api/venue-booking-requests') && init?.method === 'POST') {
      made.push(JSON.parse(init.body as string));
      return Response.json({ request: requested, booking }, { status: 201 });
    }
    if (url.startsWith('/api/venue-booking-requests')) return Response.json({ requests: made.length ? [requested] : [],
      arrangement: { state: made.length ? 'in_progress' : 'none', needed: made.length, approved: 0, pending: made.length, rejected: 0, unbooked: 0 } });
    return Response.json({ venues: [terrace] });
  });
  vi.stubGlobal('fetch', fetch);
  return made;
}

test('[NORMAL] [SG2-48:AC1] [SG2-48:AC3] from an event\'s search a venue is requested for the searched period, and is then listed as pending', async () => {
  const made = stubEventSearch();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  expect(await screen.findByText('No venues have been requested for this event yet.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Request this venue' }));
  expect(screen.getByText('A bar')).toBeVisible();
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByText('Rooftop Terrace requested. It is pending until Venue Staff decide, and the venue is not held until then.')).toBeVisible();
  expect(made).toEqual([{ event_id: 10, venue_id: 3, layout: 'banquet', starts_at: '2030-06-14T16:00:00.000Z', ends_at: '2030-06-15T15:59:00.000Z' }]);
  const list = screen.getByRole('region', { name: 'Venue requests for Meridian Forum' });
  expect(await within(list).findByText('Pending')).toBeVisible();
  expect(screen.queryByRole('form', { name: 'Request Rooftop Terrace' })).not.toBeInTheDocument();
  // A new search starts afresh.
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await vi.waitFor(() => expect(screen.queryByText(/Rooftop Terrace requested/)).not.toBeInTheDocument());
});

test('[NORMAL] [SG2-48:AC3] [SG2-47:AC5] requesting a venue too small for the event says a capacity exception is still needed; the form can be cancelled', async () => {
  stubEventSearch('needs_capacity_exception');
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Request Rooftop Terrace' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request this venue' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByText(/A capacity exception must also be approved before it can be booked\./)).toBeVisible();
});

test('[BOUNDARY] [SG2-48:AC3] after a successful request a delayed list refresh shows loading instead of the old empty result', async () => {
  let reads = 0;
  let refreshed!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue-booking-requests') && init?.method === 'POST') {
      return Response.json({ request: requested, booking: 'allowed' }, { status: 201 });
    }
    if (url.startsWith('/api/venue-booking-requests')) {
      reads += 1;
      if (reads > 1) return new Promise<Response>(resolve => { refreshed = resolve; });
      return Response.json({ requests: [], arrangement: { state: 'none', needed: 0, approved: 0, pending: 0, rejected: 0, unbooked: 0 } });
    }
    return Response.json({ venues: [terrace] });
  }));
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  await screen.findByText('No venues have been requested for this event yet.');
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByText(/Rooftop Terrace requested\./)).toBeVisible();
  const list = screen.getByRole('region', { name: 'Venue requests for Meridian Forum' });
  expect(within(list).getByText('Loading venue requests…')).toBeVisible();
  expect(within(list).queryByText('No venues have been requested for this event yet.')).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Request Rooftop Terrace' })).not.toBeInTheDocument();
  expect(reads).toBe(2);
  await act(async () => refreshed(Response.json({ requests: [requested], arrangement: {
    state: 'in_progress', needed: 1, approved: 0, pending: 1, rejected: 0, unbooked: 0
  } })));
  expect(await within(list).findByText('Pending')).toBeVisible();
  expect(within(list).getByLabelText('Venue arrangement')).toHaveTextContent('1 venue awaiting Venue Staff');
  expect(within(list).queryByText('Loading venue requests…')).not.toBeInTheDocument();
});

test('[CONFLICT] [FAILURE] [SG2-48:AC3] a refused request keeps the known list without refreshing or claiming success', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue-booking-requests') && init?.method === 'POST') {
      return Response.json({ error: 'The event is no longer assigned to you.' }, { status: 409 });
    }
    if (url.startsWith('/api/venue-booking-requests')) {
      reads += 1;
      return Response.json({ requests: [], arrangement: { state: 'none', needed: 0, approved: 0, pending: 0, rejected: 0, unbooked: 0 } });
    }
    return Response.json({ venues: [terrace] });
  }));
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  await screen.findByText('No venues have been requested for this event yet.');
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The event is no longer assigned to you.');
  const list = screen.getByRole('region', { name: 'Venue requests for Meridian Forum' });
  expect(within(list).getByText('No venues have been requested for this event yet.')).toBeVisible();
  expect(within(list).queryByText('Loading venue requests…')).not.toBeInTheDocument();
  expect(screen.getByRole('form', { name: 'Request Rooftop Terrace' })).toBeVisible();
  expect(screen.queryByText(/Rooftop Terrace requested\./)).not.toBeInTheDocument();
  expect(reads).toBe(1);
});

test('[FAILURE] [SG2-48:AC1] a manual search, not opened from an event, offers no venue request', async () => {
  stubSearch(() => Response.json({ venues: [terrace] }));
  render(<VenueSearch accessToken="token" />);
  fill({ 'From (Singapore time)': '2030-06-15T09:00', 'Until (Singapore time)': '2030-06-15T17:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('heading', { name: 'Rooftop Terrace' });
  expect(screen.queryByRole('button', { name: 'Request this venue' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /Venue requests for/ })).not.toBeInTheDocument();
});

// --- SG2-81: replacing a venue that has become unavailable ------------------------

const affectedBooking = { booking_id: 11, venue_id: 1, venue_name: 'Atrium Hall', event_id: 10, event_name: 'Meridian Forum',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed', cancelled_at: null, cancellation_reason: null,
  canceller_name: null, replacement: null,
  affected_by: [{ starts_at: '2030-06-15T00:00:00.000Z', ends_at: '2030-06-16T00:00:00.000Z', category: 'maintenance', reason: 'Roof repairs' }] };

/** An event whose booking a venue's unavailability affects; requests are recorded. */
function stubAffectedEvent(venueName: string | null = 'Atrium Hall') {
  const made: Record<string, unknown>[] = [];
  const searched: Record<string, string>[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venues/suitability')) return Response.json({ venues: [] });
    if (url.startsWith('/api/venue-bookings')) {
      return Response.json({ bookings: [made.length ? { ...affectedBooking, venue_name: venueName, replacement: { request_id: 41, venue_name: 'Rooftop Terrace' } } : { ...affectedBooking, venue_name: venueName }] });
    }
    if (url.startsWith('/api/venue-booking-requests') && init?.method === 'POST') {
      made.push(JSON.parse(init.body as string));
      return Response.json({ request: requested, booking: 'allowed' }, { status: 201 });
    }
    if (url.startsWith('/api/venue-booking-requests')) return Response.json({ requests: [], arrangement: { state: 'in_progress', needed: 1, approved: 1,
      pending: 0, rejected: 0, unbooked: 0, affected: 1 } });
    searched.push(Object.fromEntries(new URL(url, 'http://local').searchParams));
    return Response.json({ venues: [terrace] });
  });
  vi.stubGlobal('fetch', fetch);
  return { made, searched };
}

test('[NORMAL] [SG2-81:AC4] from the affected booking the coordinator searches the same period with the event\'s requirements and requests a replacement', async () => {
  const { made, searched } = stubAffectedEvent();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Find a replacement venue' }));
  // The search reruns for the affected booking\'s period (Singapore time), keeping the event\'s own attendance and accessibility.
  await vi.waitFor(() => expect(searched).toHaveLength(2));
  expect(searched[1]).toMatchObject({ from: '2030-06-15T02:00:00.000Z', to: '2030-06-15T10:00:00.000Z', attendance: '180', accessibility: 'step-free' });
  expect(screen.getByLabelText('From (Singapore time)')).toHaveValue('2030-06-15T10:00');
  expect(screen.getByText(/Finding a replacement for Atrium Hall \(booking #11/)).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  expect(screen.getByText('This replaces booking #11, which is released once Venue Staff approve this request.')).toBeVisible();
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByText(/Rooftop Terrace requested/)).toBeVisible();
  expect(made).toEqual([expect.objectContaining({ event_id: 10, venue_id: 3, replaces_booking_id: 11 })]);
  // Once requested, the banner goes and the affected booking shows the replacement asked for.
  expect(screen.queryByText(/Finding a replacement for/)).toBeNull();
  expect(await screen.findByText('Replacement requested: Rooftop Terrace, awaiting Venue Staff.')).toBeVisible();
});

test('[CONFLICT] [SG2-81:AC4] stopping the replacement makes later requests ordinary ones that release nothing', async () => {
  const { made } = stubAffectedEvent();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Find a replacement venue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop replacing this booking' }));
  expect(screen.queryByText(/Finding a replacement for/)).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  expect(screen.queryByText(/This replaces booking/)).toBeNull();
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  await screen.findByText(/Rooftop Terrace requested/);
  expect(made[0]).not.toHaveProperty('replaces_booking_id');
});

test('[BOUNDARY] [SG2-81:AC4] an affected booking whose venue has no recorded name is still named by its number when finding a replacement', async () => {
  stubAffectedEvent(null);
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Find a replacement venue' }));
  expect(await screen.findByText(/Finding a replacement for venue #1 \(booking #11/)).toBeVisible();
});

test('[NORMAL] [SG2-83:AC1] [SG2-83:AC4] the coordinator changes a venue that is not affected: the same period is searched and the change carries its reason', async () => {
  const made: Record<string, unknown>[] = [];
  const searched: Record<string, string>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venues/suitability')) return Response.json({ venues: [] });
    if (url.startsWith('/api/venue-bookings')) return Response.json({ bookings: [{ ...affectedBooking, affected_by: [] }] });
    if (url.startsWith('/api/venue-booking-requests') && init?.method === 'POST') {
      made.push(JSON.parse(init.body as string));
      return Response.json({ request: requested, booking: 'allowed' }, { status: 201 });
    }
    if (url.startsWith('/api/venue-booking-requests')) return Response.json({ requests: [], arrangement: { state: 'ready', needed: 1, approved: 1,
      pending: 0, rejected: 0, unbooked: 0, affected: 0 } });
    searched.push(Object.fromEntries(new URL(url, 'http://local').searchParams));
    return Response.json({ venues: [terrace] });
  }));
  // The page scrolls up to say which booking is being changed (jsdom has no scrolling of its own).
  const scrolled: Element[] = [];
  const scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this); });
  Element.prototype.scrollIntoView = scrollIntoView;
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change venue' }));
  await vi.waitFor(() => expect(searched).toHaveLength(2));
  expect(screen.getByText(/Changing Atrium Hall \(booking #11/)).toHaveTextContent('the event\'s other venues are not affected');
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  expect(scrolled[0]).toContainElement(screen.getByText(/Changing Atrium Hall/));
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  fireEvent.click(await screen.findByRole('button', { name: 'Request this venue' }));
  fireEvent.change(screen.getByLabelText('Reason for the change'), { target: { value: 'More seats needed' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));
  expect(await screen.findByText(/Rooftop Terrace requested/)).toBeVisible();
  expect(made).toEqual([expect.objectContaining({ replaces_booking_id: 11, change_reason: 'More seats needed' })]);
});

// Real child panels and their public reads: another user can decide a request
// while this coordinator keeps the same search screen open.
const confirmedSearchBooking = { ...affectedBooking, booking_id: 42, venue_id: 3, venue_name: 'Rooftop Terrace',
  starts_at: requested.starts_at, ends_at: requested.ends_at, affected_by: [] };
function requestSnapshot(approved: boolean) {
  return Response.json({ requests: [{ ...requested, status: approved ? 'approved' : 'pending',
    decider_name: approved ? 'Venue Staff' : null, decided_at: approved ? '2030-01-02T00:00:00.000Z' : null }],
    arrangement: { state: approved ? 'ready' : 'in_progress', needed: 1, approved: approved ? 1 : 0,
      pending: approved ? 0 : 1, rejected: 0, unbooked: 0, affected: 0 } });
}
function bookingSnapshot(approved: boolean) {
  return Response.json({ bookings: approved ? [confirmedSearchBooking] : [] });
}
function liveArrangementFixture() {
  const state = { approved: false, searchFails: false, panelsFail: false, delayPanels: false, requests: 0, bookings: 0 };
  const deferred: { requests?: (response: Response) => void; bookings?: (response: Response) => void } = {};
  const fetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url.startsWith('/api/venues/suitability')) return Response.json({ venues: [] });
    if (url === '/api/venue-booking-requests?event_id=10') {
      state.requests += 1;
      if (state.delayPanels) return new Promise(resolve => { deferred.requests = resolve; });
      return state.panelsFail ? Response.json({}, { status: 503 }) : requestSnapshot(state.approved);
    }
    if (url === '/api/venue-bookings?event_id=10') {
      state.bookings += 1;
      if (state.delayPanels) return new Promise(resolve => { deferred.bookings = resolve; });
      return state.panelsFail ? Response.json({}, { status: 403 }) : bookingSnapshot(state.approved);
    }
    if (url.startsWith('/api/venues/search?')) {
      return state.searchFails ? Response.json({}, { status: 503 }) : Response.json({ venues: state.approved ? [] : [terrace] });
    }
    throw new Error(`Unexpected read: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, deferred, fetch };
}

test('[NORMAL] [SG2-48:AC3] [SG2-82:AC4] [SG2-82:AC5] searching again reconciles an externally approved venue request, its confirmed booking and ready summary without changing criteria', async () => {
  const { state, fetch } = liveArrangementFixture();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  const requests = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  const bookings = await screen.findByRole('region', { name: 'Booked venues for Meridian Forum' });
  await within(requests).findByText('Pending');
  await within(bookings).findByText('No venues are booked for this event yet.');
  fill({ Attendance: '100', Layout: 'banquet', Location: 'Level', Facilities: 'bar', Accessibility: 'lift' });
  state.approved = true;
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('heading', { name: 'No venues match' });
  expect(await within(requests).findByText('Approved', { exact: true })).toBeVisible();
  expect(within(requests).getByLabelText('Venue arrangement')).toHaveTextContent('Venue arrangement ready: the venue is approved.');
  expect(await within(bookings).findByRole('listitem', { name: 'Booking #42' })).toHaveTextContent('Confirmed');
  expect(within(requests).queryByText('Pending')).not.toBeInTheDocument();
  expect(within(bookings).queryByText('No venues are booked for this event yet.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Attendance')).toHaveValue(100);
  expect(screen.getByLabelText('Layout')).toHaveValue('banquet');
  expect(screen.getByLabelText('Location')).toHaveValue('Level');
  expect(screen.getByLabelText('Facilities')).toHaveValue('bar');
  expect(screen.getByLabelText('Accessibility')).toHaveValue('lift');
  expect(state.requests).toBe(2); expect(state.bookings).toBe(2);
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

test('[BOUNDARY] [SG2-48:AC3] [SG2-82:AC4] [SG2-82:AC5] a zero-match search hides stale pending and empty booking panels while their fresh reads are delayed', async () => {
  const { state, deferred } = liveArrangementFixture();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  const requests = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  const bookings = await screen.findByRole('region', { name: 'Booked venues for Meridian Forum' });
  await within(requests).findByText('Pending');
  await within(bookings).findByText('No venues are booked for this event yet.');
  state.approved = true; state.delayPanels = true;
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('heading', { name: 'No venues match' });
  expect(within(requests).getByText('Loading venue requests…')).toBeVisible();
  expect(within(bookings).getByText('Loading bookings…')).toBeVisible();
  expect(within(requests).queryByText('Pending')).not.toBeInTheDocument();
  expect(within(requests).queryByLabelText('Venue arrangement')).not.toBeInTheDocument();
  expect(within(bookings).queryByText('No venues are booked for this event yet.')).not.toBeInTheDocument();
  await act(async () => { deferred.requests!(requestSnapshot(true)); deferred.bookings!(bookingSnapshot(true)); });
  expect(await within(requests).findByText('Approved', { exact: true })).toBeVisible();
  expect(await within(bookings).findByText('Confirmed', { exact: true })).toBeVisible();
});

test('[FAILURE] [SG2-48:AC3] [SG2-82:AC4] a failed search leaves known arrangements alone, and failed panel reads report errors until a successful search recovers them', async () => {
  const { state } = liveArrangementFixture();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  const requests = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  const bookings = await screen.findByRole('region', { name: 'Booked venues for Meridian Forum' });
  await within(requests).findByText('Pending');
  await within(bookings).findByText('No venues are booked for this event yet.');
  state.searchFails = true;
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('alert');
  expect(state.requests).toBe(1); expect(state.bookings).toBe(1);
  expect(within(requests).getByText('Pending')).toBeVisible();
  state.searchFails = false; state.panelsFail = true; state.approved = true;
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await within(requests).findByText('Venue requests are unavailable right now. Please try again.')).toBeVisible();
  expect(await within(bookings).findByText('Your account cannot manage these venue bookings.')).toBeVisible();
  expect(within(requests).queryByLabelText('Venue arrangement')).not.toBeInTheDocument();
  expect(within(bookings).queryByText('No venues are booked for this event yet.')).not.toBeInTheDocument();
  state.panelsFail = false;
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(await within(requests).findByText('Approved', { exact: true })).toBeVisible();
  expect(await within(bookings).findByText('Confirmed', { exact: true })).toBeVisible();
  expect(within(requests).queryByText(/unavailable right now/)).not.toBeInTheDocument();
  expect(within(bookings).queryByText(/cannot manage/)).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-46:AC2] [SG2-48:AC3] an invalid new period does not revalidate or erase the current event arrangement', async () => {
  const { state } = liveArrangementFixture();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  const requests = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  await within(requests).findByText('Pending');
  fill({ 'Until (Singapore time)': '2030-06-14T23:00' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a period that starts before it ends.');
  expect(within(requests).getByText('Pending')).toBeVisible();
  expect(state.requests).toBe(1); expect(state.bookings).toBe(1);
});

test('[CONFLICT] [SG2-46:search-supersession] [SG2-82:AC4] a superseded late search cannot replace current results or trigger an obsolete arrangement reload', async () => {
  const fixture = liveArrangementFixture();
  render(<VenueSearch accessToken="token" prefill={prefill} />);
  await screen.findByText('Pending');
  let old!: (response: Response) => void;
  const original = fixture.fetch.getMockImplementation()!;
  let searchCalls = 0;
  fixture.fetch.mockImplementation((url, init) => url.startsWith('/api/venues/search?') && searchCalls++ === 0
    ? new Promise(resolve => { old = resolve; }) : original(url, init));
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  fixture.state.approved = true;
  fill({ Attendance: '181' });
  fireEvent.submit(screen.getByRole('form', { name: 'Venue search criteria' }));
  await screen.findByRole('heading', { name: 'No venues match' });
  await screen.findByText('Approved', { exact: true });
  expect(fixture.state.requests).toBe(2); expect(fixture.state.bookings).toBe(2);
  await act(async () => old(Response.json({ venues: [terrace] })));
  expect(screen.getByRole('heading', { name: 'No venues match' })).toBeVisible();
  // The approved request still names its venue; no obsolete search result
  // may reintroduce a request action after the newer zero-match search.
  expect(screen.queryByRole('button', { name: 'Request this venue' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Attendance')).toHaveValue(181);
  expect(fixture.state.requests).toBe(2); expect(fixture.state.bookings).toBe(2);
});

test('[BOUNDARY] [SG2-48:AC3] [SG2-82:AC4] leaving an event aborts its search and the next event reads only its own arrangement', async () => {
  let old!: (response: Response) => void;
  const fetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url.startsWith('/api/venues/search?') && fetch.mock.calls.length === 1) return new Promise(resolve => { old = resolve; });
    if (url.startsWith('/api/venues/search?') || url.startsWith('/api/venues/suitability')) return Response.json({ venues: [] });
    if (url === '/api/venue-booking-requests?event_id=20') return Response.json({ requests: [], arrangement: {
      state: 'none', needed: 0, approved: 0, pending: 0, rejected: 0, unbooked: 0, affected: 0 } });
    if (url === '/api/venue-bookings?event_id=20') return Response.json({ bookings: [] });
    throw new Error(`Wrong event read: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const first = render(<VenueSearch accessToken="old-token" prefill={prefill} />);
  first.unmount();
  render(<VenueSearch accessToken="new-token" prefill={{ ...prefill, eventId: 20, eventName: 'Second Forum' }} />);
  await screen.findByText('No venues have been requested for this event yet.');
  await act(async () => old(Response.json({ venues: [terrace] })));
  expect(screen.getByRole('region', { name: 'Venue requests for Second Forum' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Booked venues for Second Forum' })).toBeVisible();
  expect(screen.queryByText('For: Meridian Forum (#10)')).not.toBeInTheDocument();
  const eventReads = fetch.mock.calls.filter(([url]) => url.startsWith('/api/venue-book'));
  expect(eventReads.map(([url]) => url)).toEqual(['/api/venue-booking-requests?event_id=20', '/api/venue-bookings?event_id=20']);
  expect(eventReads.every(([, init]) => (init?.headers as Record<string, string>).Authorization === 'Bearer new-token')).toBe(true);
});
