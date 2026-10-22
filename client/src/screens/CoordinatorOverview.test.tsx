import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CoordinatorOverview from './CoordinatorOverview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COORDINATORS = [
  { user_id: 'c1', name: 'Ada Coordinator', active_events: 2, assignable: true },
  { user_id: 'c2', name: 'Ben Coordinator', active_events: 0, assignable: true },
  { user_id: 'c9', name: 'Gil Former', active_events: 1, assignable: false },
];
const EVENTS = [
  { event_id: 4, name: 'Partner Forum', organisation: 'Acme', status: 'needs_clarification',
    proposed_date: '2030-06-15T02:00:00.000Z', coordinator_id: 'c1', coordinator_name: 'Ada Coordinator' },
  { event_id: 5, name: '  ', organisation: null, status: 'planning', proposed_date: null, coordinator_id: 'c1', coordinator_name: 'Ada Coordinator' },
  { event_id: 6, name: 'Legacy Gala', organisation: 'Beta', status: 'approved', proposed_date: null, coordinator_id: 'c9', coordinator_name: null },
];
const STATUSES = ['submitted', 'needs_clarification', 'approved', 'planning'];

type Answer = (url: string, init?: RequestInit) => Response | Promise<Response>;
const overview = (events = EVENTS, coordinators = COORDINATORS) => Response.json({ events, coordinators, statuses: STATUSES });

/** Answers the overview read through `read` and PATCHes through `patch`. */
function api(read: Answer = () => overview(), patch: Answer = () => Response.json({ request: { status: 'needs_clarification' } })) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    if (init?.method === 'PATCH') return patch(url, init);
    if (url.endsWith('/history')) return Response.json({ event_id: 4, history: [] });
    expect(url.startsWith('/api/coordinator-overview')).toBe(true);
    return read(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const reads = (fetchMock: ReturnType<typeof api>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/coordinator-overview'));

describe('CoordinatorOverview (SG2-89)', () => {
  test('[NORMAL] [SG2-89:AC1] lists each supervised event with its coordinator and status', async () => {
    api();
    render(<CoordinatorOverview accessToken="tok" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the coordinator overview…');

    const forum = await screen.findByRole('article', { name: 'Partner Forum' });
    expect(within(forum).getByText('E-4 · Acme')).toBeInTheDocument();
    expect(within(forum).getByText('Clarification Needed')).toBeInTheDocument();
    expect(within(forum).getByText('Ada Coordinator')).toBeInTheDocument();
    const untitled = screen.getByRole('article', { name: 'Untitled event' });
    expect(within(untitled).getByText('E-5 · No organisation')).toBeInTheDocument();
    expect(within(untitled).getByText('Not recorded')).toBeInTheDocument();
    // A coordinator who has since lost the role still shows against their event.
    expect(within(screen.getByRole('article', { name: 'Legacy Gala' })).getByText('Former coordinator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 active events under your supervision' })).toBeInTheDocument();
  });

  test('[NORMAL] [SG2-89:AC2] shows every coordinator\'s workload, including one with nothing, and opens their events', async () => {
    const fetchMock = api();
    render(<CoordinatorOverview accessToken="tok" />);
    const workload = await screen.findByRole('list', { name: 'Coordinator workload' });
    expect(within(workload).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Ada Coordinator2 active events', 'Ben Coordinator0 active events', 'Gil Former1 active event',
    ]);

    const ada = within(workload).getByRole('button', { name: /Ada Coordinator/ });
    fireEvent.click(ada);
    expect(ada).toHaveAttribute('aria-pressed', 'true');
    await screen.findByRole('heading', { name: '3 active events match these filters' });
    fireEvent.click(ada);
    expect(ada).toHaveAttribute('aria-pressed', 'false');
    await screen.findByRole('heading', { name: '3 active events under your supervision' });
    expect(reads(fetchMock)).toEqual([
      '/api/coordinator-overview', '/api/coordinator-overview?coordinatorId=c1', '/api/coordinator-overview',
    ]);
  });

  test('[NORMAL] [SG2-89:AC3] [SG2-89:AC6] filters by coordinator and status, including awaiting clarification, and clears both', async () => {
    const fetchMock = api((url) => (url.includes('status=needs_clarification') ? overview([EVENTS[0]]) : overview()));
    render(<CoordinatorOverview accessToken="tok" />);
    await screen.findByRole('article', { name: 'Partner Forum' });
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear).toBeDisabled();
    expect(within(screen.getByLabelText('Status')).getByRole('option', { name: 'Clarification Needed' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Coordinator'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'needs_clarification' } });
    await screen.findByRole('heading', { name: '1 active event matches these filters' });
    expect(screen.queryByRole('article', { name: 'Legacy Gala' })).not.toBeInTheDocument();

    fireEvent.click(clear);
    await screen.findByRole('heading', { name: '3 active events under your supervision' });
    expect(reads(fetchMock)).toEqual([
      '/api/coordinator-overview',
      '/api/coordinator-overview?coordinatorId=c1',
      '/api/coordinator-overview?coordinatorId=c1&status=needs_clarification',
      '/api/coordinator-overview',
    ]);
  });

  test('[BOUNDARY] [SG2-89:AC1] [SG2-89:AC3] says why the list is empty, with and without filters', async () => {
    api((url) => overview(url.includes('status') ? [] : [], []));
    render(<CoordinatorOverview accessToken="tok" />);
    expect(await screen.findByText('Events appear here once you assign them a coordinator.')).toBeInTheDocument();
    expect(screen.getByText('No Event Coordinators yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '0 active events under your supervision' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'planning' } });
    expect(await screen.findByText('No active events you supervise match these filters.')).toBeInTheDocument();
  });

  test('[NORMAL] [SG2-89:AC6] reassigns an event awaiting clarification and says it kept its status', async () => {
    const fetchMock = api();
    render(<CoordinatorOverview accessToken="tok" />);
    const forum = await screen.findByRole('article', { name: 'Partner Forum' });
    const picker = within(forum).getByLabelText('Reassign Partner Forum to');
    // Only current coordinators other than the one holding it are offered.
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a coordinator', 'Ben Coordinator']);
    const button = within(forum).getByRole('button', { name: 'Reassign' });
    expect(button).toBeDisabled();

    fireEvent.change(picker, { target: { value: 'c2' } });
    fireEvent.click(button);
    expect(await screen.findByText('Partner Forum is now with Ben Coordinator. It is still Clarification Needed.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/4/coordinator', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ coordinatorId: 'c2' }),
    }));
    // The workload is read again so the counts follow the reassignment.
    await vi.waitFor(() => expect(reads(fetchMock)).toHaveLength(2));
    expect(within(screen.getByRole('article', { name: 'Partner Forum' })).getByLabelText('Reassign Partner Forum to')).toHaveValue('');
  });

  test('[BOUNDARY] [SG2-89:AC6] when the answer carries no status, the event\'s own status is named', async () => {
    let release!: (response: Response) => void;
    api(undefined, () => new Promise<Response>((resolve) => { release = resolve; }));
    render(<CoordinatorOverview accessToken="tok" />);
    const gala = await screen.findByRole('article', { name: 'Legacy Gala' });
    fireEvent.change(within(gala).getByLabelText('Reassign Legacy Gala to'), { target: { value: 'c1' } });
    fireEvent.click(within(gala).getByRole('button', { name: 'Reassign' }));
    expect(within(gala).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => release(Response.json({ request: {} })));
    expect(await screen.findByText('Legacy Gala is now with Ada Coordinator. It is still Approved.')).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-89:AC6] [SG2-89:AC1] a reassignment another Lead beat shows the server\'s reason on that event', async () => {
    api(undefined, () => Response.json({ error: 'This request changed while you were assigning it. Reload the list and try again.' }, { status: 409 }));
    render(<CoordinatorOverview accessToken="tok" />);
    const forum = await screen.findByRole('article', { name: 'Partner Forum' });
    fireEvent.change(within(forum).getByLabelText('Reassign Partner Forum to'), { target: { value: 'c2' } });
    fireEvent.click(within(forum).getByRole('button', { name: 'Reassign' }));
    expect(await within(forum).findByRole('alert')).toHaveTextContent('This request changed while you were assigning it.');
    expect(screen.queryByText(/is now with/)).not.toBeInTheDocument();
  });

  test('[NORMAL] [SG2-89:AC1] opens and closes an event\'s change history', async () => {
    api();
    render(<CoordinatorOverview accessToken="tok" />);
    await screen.findByRole('article', { name: 'Partner Forum' });
    fireEvent.click(screen.getByRole('button', { name: 'View change history for Partner Forum' }));
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test.each([
    [403, 'Only the Event Coordinator Lead can see the coordinator overview.'],
    [503, 'The coordinator overview is temporarily unavailable. Please try again.'],
  ])('[FAILURE] [SG2-89:AC4] a first read answered %i explains itself and can be retried', async (status, message) => {
    let answers = 0;
    api(() => (++answers === 1 ? new Response(null, { status }) : overview()));
    render(<CoordinatorOverview accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('article', { name: 'Partner Forum' })).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-89:AC3] a refused filter keeps the last list on screen with the reason and a retry', async () => {
    let refuse = true;
    api((url) => (url.includes('status') && refuse
      ? Response.json({ error: 'status must be the status of an active event.' }, { status: 400 })
      : overview()));
    render(<CoordinatorOverview accessToken="tok" />);
    await screen.findByRole('article', { name: 'Partner Forum' });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'submitted' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('status must be the status of an active event.');
    expect(screen.getByRole('article', { name: 'Partner Forum' })).toBeInTheDocument();
    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  test('[FAILURE] [SG2-89:AC1] an answer arriving after the screen closed is ignored', async () => {
    let release!: (response: Response) => void;
    api(() => new Promise<Response>((resolve) => { release = resolve; }));
    const { unmount } = render(<CoordinatorOverview accessToken="tok" />);
    unmount();
    await act(async () => release(overview()));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-89:AC1] shows "Updating" while a filter change is loading', async () => {
    let release!: (response: Response) => void;
    let first = true;
    api(() => {
      if (first) { first = false; return overview(); }
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    render(<CoordinatorOverview accessToken="tok" />);
    await screen.findByRole('article', { name: 'Partner Forum' });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'planning' } });
    expect(screen.getByText('Updating the overview…')).toBeInTheDocument();
    await act(async () => release(overview([EVENTS[1]])));
    expect(screen.queryByText('Updating the overview…')).not.toBeInTheDocument();
  });
});
