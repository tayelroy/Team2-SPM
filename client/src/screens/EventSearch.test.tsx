import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import EventSearch, { describeFilters } from './EventSearch';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTIONS = {
  venues: [{ venue_id: 1, name: 'Atrium Hall' }, { venue_id: 2, name: 'Quiet Room' }],
  coordinators: [{ user_id: 'c1', name: 'Alice Tan' }],
};
const NO_FILTERS = { query: null, date_from: null, date_to: null, status: null, venue_id: null, category: null, coordinator_id: null };
const GALA = {
  event_id: 701, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social', status: 'planning',
  proposed_date: '2030-11-01T02:00:00.000Z', coordinator_id: 'c1', coordinator_name: 'Alice Tan', venues: ['Atrium Hall'],
};
const SUMMIT = {
  event_id: 702, name: 'Coastal Leaders Summit', organisation: 'Coastal Partners', category: 'conference', status: 'approved',
  proposed_date: '2030-11-02T02:00:00.000Z', coordinator_id: null, coordinator_name: null, venues: [],
};

type Body = { events: unknown[]; truncated?: boolean; filters: Record<string, unknown> };

/** Routes the screen's two requests: the options, and each search by its query string. */
function serve(search: (url: URL) => Response | Promise<Response>, options: () => Response | Promise<Response> = () => Response.json(OPTIONS)) {
  const fetch = vi.fn(async (input: string, _init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    return url.pathname === '/api/event-search/options' ? options() : search(url);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const page = (events: unknown[], filters: Record<string, unknown> = NO_FILTERS, truncated = false): Body => ({ events, truncated, filters });
const searches = (fetch: ReturnType<typeof serve>) =>
  fetch.mock.calls.map(([url]) => url).filter((url) => !url.endsWith('/options'));

describe('EventSearch (SG2-70)', () => {
  test('[NORMAL] [SG2-70:AC1] opening the screen lists the events the caller may see, each with what identifies it', async () => {
    const fetch = serve(() => Response.json(page([GALA, SUMMIT])));
    render(<EventSearch accessToken="token" />);
    expect(screen.getByRole('status')).toHaveTextContent('Searching events…');
    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(within(results).getByRole('heading', { level: 2 })).toHaveTextContent('2 events found');
    const gala = within(results).getByRole('article', { name: 'Harbour Gala' });
    for (const text of ['Harbour Foundation', 'Social', 'Atrium Hall', 'Alice Tan', '#701', 'Arrangements']) {
      expect(within(gala).getByText(text)).toBeInTheDocument();
    }
    const summit = within(results).getByRole('article', { name: 'Coastal Leaders Summit' });
    expect(within(summit).getByText('No venue yet')).toBeInTheDocument();
    expect(within(summit).getByText('Unassigned')).toBeInTheDocument();
    expect(within(summit).getByText('Conference')).toBeInTheDocument();
    expect(searches(fetch)).toEqual(['/api/event-search']);
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  test('[NORMAL] [SG2-70:AC1] [SG2-70:AC2] the search text and every filter are sent together', async () => {
    const fetch = serve((url) => Response.json(page(url.search ? [GALA] : [GALA, SUMMIT])));
    render(<EventSearch accessToken="token" />);
    await screen.findByText('2 events found');
    await waitFor(() => expect(screen.getByLabelText('Venue')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Event name or client organisation'), { target: { value: ' harbour ' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2030-11-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2030-11-30' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'planning' } });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'social' } });
    fireEvent.change(screen.getByLabelText('Assigned coordinator'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('1 event found')).toBeInTheDocument();
    expect(searches(fetch).at(-1)).toBe('/api/event-search?q=harbour&from=2030-11-01&to=2030-11-30&status=planning&venue=1&category=social&coordinator=c1');
  });

  test('[NORMAL] [SG2-70:AC2] the filters offer every state but Draft, the seven categories, and the venues and coordinators', async () => {
    let stale!: (response: Response) => void;
    let optionReads = 0;
    serve(() => Response.json(page([GALA])), () => ++optionReads === 1
      ? new Promise<Response>(resolve => { stale = resolve; }) : Response.json(OPTIONS));
    render(<StrictMode><EventSearch accessToken="token" /></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText('Venue')).not.toBeDisabled());
    const options = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((option) => option.text);
    expect(options('State')).not.toContain('Draft');
    expect(options('State')).toContain('Awaiting Safety Check');
    expect(options('State')[0]).toBe('Any state');
    expect(options('Category')).toEqual(['Any category', 'Conference', 'Workshop', 'Seminar', 'Training', 'Networking', 'Social', 'Other']);
    expect(options('Venue')).toEqual(['Any venue', 'Atrium Hall', 'Quiet Room']);
    expect(options('Assigned coordinator')).toEqual(['Any coordinator', 'Unassigned', 'Alice Tan']);
    await act(async () => stale(Response.json({ venues: [], coordinators: [] })));
    expect(options('Venue')).toEqual(['Any venue', 'Atrium Hall', 'Quiet Room']);
    expect(options('Assigned coordinator')).toEqual(['Any coordinator', 'Unassigned', 'Alice Tan']);
  });

  test('[NORMAL] [SG2-70:AC4] when nothing matches, the screen says so and lists every filter the server applied', async () => {
    const applied = { query: 'nothing', date_from: '2030-11-01', date_to: '2030-11-30', status: 'planning', venue_id: 2,
      category: 'training', coordinator_id: 'c1' };
    const fetch = serve((url) => Response.json(url.search ? page([], applied) : page([GALA])));
    render(<EventSearch accessToken="token" />);
    await screen.findByText('1 event found');
    await waitFor(() => expect(screen.getByLabelText('Venue')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Event name or client organisation'), { target: { value: 'nothing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('heading', { name: 'No events match' })).toBeInTheDocument();
    const listed = within(screen.getByRole('list', { name: 'Filters in force' })).getAllByRole('listitem').map((item) => item.textContent);
    expect(listed).toEqual(['Name or organisation contains “nothing”', 'Date 1 Nov 2030 – 30 Nov 2030', 'State: Arrangements',
      'Venue: Quiet Room', 'Category: Training', 'Coordinator: Alice Tan']);

    // Clearing the filters searches again with none.
    const clears = screen.getAllByRole('button', { name: 'Clear filters' });
    fireEvent.click(clears[clears.length - 1]);
    expect(await screen.findByText('1 event found')).toBeInTheDocument();
    expect(screen.getByLabelText('Event name or client organisation')).toHaveValue('');
    expect(searches(fetch).at(-1)).toBe('/api/event-search');
  });

  test('[BOUNDARY] [SG2-70:AC4] with no filters and no events, the screen explains that drafts are not shown', async () => {
    serve(() => Response.json(page([])));
    render(<EventSearch accessToken="token" />);
    expect(await screen.findByText('There are no submitted events for your role yet. Drafts are not shown until they are submitted.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Filters in force' })).not.toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-70:AC1] a truncated page asks for a narrower search, and missing details read as not recorded', async () => {
    const sparse = { event_id: 9, name: '  ', organisation: null, category: null, status: 'submitted', proposed_date: null,
      coordinator_id: null, coordinator_name: null, venues: ['Annex', 'Atrium Hall'] };
    serve(() => Response.json(page([sparse], NO_FILTERS, true)));
    render(<EventSearch accessToken="token" />);
    expect(await screen.findByText('Showing the first 1 matching events. Narrow your search to see the rest.')).toBeInTheDocument();
    const article = screen.getByRole('article', { name: 'Untitled event' });
    expect(within(article).getAllByText('Not recorded')).toHaveLength(2);
    expect(within(article).getByText('Uncategorised')).toBeInTheDocument();
    expect(within(article).getByText('Annex, Atrium Hall')).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-70:AC3] a caller the server refuses is told only staff can search, with no retry', async () => {
    serve(() => new Response(null, { status: 403 }), () => new Response(null, { status: 403 }));
    render(<EventSearch accessToken="token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only ConnectSphere staff can search events.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('[FAILURE] [SG2-70:AC2] a filter the server refuses shows its message', async () => {
    serve((url) => url.search ? Response.json({ error: 'The start date must not be after the end date.' }, { status: 400 }) : Response.json(page([GALA])));
    render(<EventSearch accessToken="token" />);
    await screen.findByText('1 event found');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2030-12-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2030-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The start date must not be after the end date.');
  });

  test('[FAILURE] [SG2-70:AC1] an unavailable search can be retried with the same filters, and missing options are explained', async () => {
    let calls = 0;
    const fetch = serve(() => (++calls === 1 ? new Response(null, { status: 503 }) : Response.json(page([GALA]))),
      () => new Response(null, { status: 500 }));
    render(<EventSearch accessToken="token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Event search is temporarily unavailable. Please try again.');
    expect(await screen.findByText('Venue and coordinator lists are unavailable right now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Venue')).toBeDisabled();
    expect(screen.getByLabelText('Assigned coordinator')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 event found')).toBeInTheDocument();
    expect(searches(fetch)).toEqual(['/api/event-search', '/api/event-search']);
  });

  test('[CONFLICT] [SG2-70:AC1] a slower earlier search never replaces the results of a newer one', async () => {
    let releaseFirst!: (response: Response) => void;
    serve((url) => url.search
      ? Response.json(page([SUMMIT], { ...NO_FILTERS, query: 'coastal' }))
      : new Promise<Response>((resolve) => { releaseFirst = resolve; }));
    render(<EventSearch accessToken="token" />);
    fireEvent.change(screen.getByLabelText('Event name or client organisation'), { target: { value: 'coastal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('article', { name: 'Coastal Leaders Summit' })).toBeInTheDocument();
    releaseFirst(Response.json(page([GALA, SUMMIT])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('article', { name: 'Harbour Gala' })).not.toBeInTheDocument();
    expect(screen.getByText('1 event found')).toBeInTheDocument();
  });


});

describe('describeFilters (SG2-70 AC4)', () => {
  const none = { query: null, dateFrom: null, dateTo: null, status: null, venueId: null, category: null, coordinatorId: null };

  test('[BOUNDARY] [SG2-70:AC4] an open-ended date range reads as from or until', () => {
    expect(describeFilters({ ...none, dateFrom: '2030-11-01' }, null)).toEqual(['Date from 1 Nov 2030']);
    expect(describeFilters({ ...none, dateTo: '2030-11-30' }, null)).toEqual(['Date until 30 Nov 2030']);
    expect(describeFilters(none, null)).toEqual([]);
  });

  test('[NORMAL] [SG2-70:AC4] the Unassigned coordinator filter reads as Unassigned', () => {
    expect(describeFilters({ ...none, coordinatorId: 'unassigned' }, null)).toEqual(['Coordinator: Unassigned']);
  });

  test('[FAILURE] [SG2-70:AC4] a venue or coordinator the options do not name is still shown, not hidden', () => {
    expect(describeFilters({ ...none, venueId: 9, coordinatorId: 'gone' }, null)).toEqual(['Venue: #9', 'Coordinator: Unknown coordinator']);
    expect(describeFilters({ ...none, venueId: 9, coordinatorId: 'gone' }, { venues: [], coordinators: [] }))
      .toEqual(['Venue: #9', 'Coordinator: Unknown coordinator']);
  });
});
