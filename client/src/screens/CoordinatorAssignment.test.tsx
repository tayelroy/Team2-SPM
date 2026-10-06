import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CoordinatorAssignment from './CoordinatorAssignment';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COORDINATORS = [
  { user_id: 'c1', name: 'Sarah Coordinator' },
  { user_id: 'c2', name: 'Raj Coordinator' },
];
const REQUESTS = [
  { event_id: 7, name: 'Partner Forum', organisation: 'Acme', status: 'submitted', coordinator_id: null, coordinator_name: null },
  { event_id: 8, name: '  ', organisation: null, status: 'under_review', coordinator_id: 'c1', coordinator_name: 'Sarah Coordinator' },
];

/** Answers the list call, and PATCHes through `patch` (default: success). */
function api(
  list: () => Response | Promise<Response> = () => Response.json({ requests: REQUESTS, coordinators: COORDINATORS }),
  patch: (url: string, init: RequestInit) => Response | Promise<Response> = () => Response.json({ request: {} }),
  history: (url: string) => Response | Promise<Response> = () => Response.json({ event_id: 0, history: [] }),
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    if (init?.method === 'PATCH') return patch(url, init);
    if (url.endsWith('/history')) return history(url);
    expect(url).toBe('/api/event-requests/assignable');
    return list();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CoordinatorAssignment (SG2-33/34)', () => {
  test('[NORMAL] [SG2-33:AC1] lists requests, marking who is assigned and who is not', async () => {
    api();
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading requests…');

    await screen.findByRole('heading', { name: 'Partner Forum' });
    expect(screen.getByText('Coordinator: Unassigned')).toBeInTheDocument();
    expect(screen.getByText('E-7 · Acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Untitled request' })).toBeInTheDocument();
    expect(screen.getByText('E-8 · No organisation')).toBeInTheDocument();
    expect(screen.getByText('Coordinator: Sarah Coordinator')).toBeInTheDocument();
    // Already holds a coordinator, and nothing new chosen: nothing to save.
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeDisabled();
  });

  test('[NORMAL] [SG2-33:AC1] assigns a coordinator to an unassigned request (SG2-33)', async () => {
    const fetchMock = api();
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Assigned to Raj Coordinator.')).toBeInTheDocument();
    expect(screen.getByText('Coordinator: Raj Coordinator')).toBeInTheDocument();
    const reassignButtons = screen.getAllByRole('button', { name: 'Reassign' });
    expect(reassignButtons).toHaveLength(2);
    for (const button of reassignButtons) expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/event-requests/7/coordinator',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ coordinatorId: 'c2' }) }),
    );
  });

  test('[NORMAL] [SG2-34:AC1] reassigns a request to a different coordinator (SG2-34)', async () => {
    api();
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    const select = screen.getByLabelText('Coordinator for Untitled request');
    expect(select).toHaveValue('c1');
    fireEvent.change(select, { target: { value: 'c2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));

    expect(await screen.findByText('Assigned to Raj Coordinator.')).toBeInTheDocument();
    expect(screen.getByText('Coordinator: Raj Coordinator')).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-33:AC1] shows the reason and keeps the old coordinator when the save is refused', async () => {
    api(undefined, () => Response.json({ error: 'A coordinator can only be assigned to a submitted request.' }, { status: 409 }));
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A coordinator can only be assigned to a submitted request.');
    expect(screen.getByText('Coordinator: Unassigned')).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-33:duplicate-submit] disables the button while a save is in flight', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = api(undefined, () => new Promise<Response>((resolve) => (finish = resolve)));
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    finish(Response.json({ request: {} }));
    expect(await screen.findByText('Assigned to Sarah Coordinator.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  test('[FAILURE] [SG2-33:AC1] offers a retry when requests cannot be loaded', async () => {
    let calls = 0;
    api(() => (++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ requests: REQUESTS, coordinators: COORDINATORS })));
    render(<CoordinatorAssignment accessToken="tok" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Requests are temporarily unavailable. Please try again later.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-97:AC1] explains a refusal to a signed-in account that is not the Event Coordinator Lead', async () => {
    api(() => new Response(null, { status: 403 }));
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the Event Coordinator Lead can assign coordinators.');
  });

  test('[BOUNDARY] [SG2-33:AC1] says so when there is nothing to assign', async () => {
    api(() => Response.json({ requests: [], coordinators: COORDINATORS }));
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(await screen.findByRole('heading', { name: 'Nothing to assign' })).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-33:AC1] ignores a response that arrives after the screen is closed', async () => {
    let resolve!: (response: Response) => void;
    api(() => new Promise<Response>((r) => (resolve = r)));
    const { unmount } = render(<CoordinatorAssignment accessToken="tok" />);
    unmount();
    resolve(Response.json({ requests: REQUESTS, coordinators: COORDINATORS }));
    await waitFor(() => expect(screen.queryByRole('heading')).not.toBeInTheDocument());
  });

  test('[NORMAL] [SG2-34:AC4] [SG2-97:AC2] the Event Coordinator Lead can open the history and still see assignments Technical Support made', async () => {
    const fetchMock = api(undefined, undefined, (url) => {
      expect(url).toBe('/api/event-requests/8/history');
      return Response.json({
        event_id: 8,
        history: [
          { log_id: 2, event_id: 8, actor_id: 'tss-1', actor_name: 'Technical Support One', field_name: 'coordinator_id',
            old_value: 'Sarah Coordinator', new_value: 'Raj Coordinator', created_at: '2026-10-02T02:30:00.000Z' },
          { log_id: 1, event_id: 8, actor_id: 'tss-1', actor_name: 'Technical Support One', field_name: 'coordinator_id',
            old_value: null, new_value: 'Sarah Coordinator', created_at: '2026-10-01T01:00:00.000Z' },
        ],
      });
    });
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Untitled request'), { target: { value: 'c2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await screen.findByText('Assigned to Raj Coordinator.');

    fireEvent.click(screen.getByRole('button', { name: 'View change history for Untitled request' }));
    const drawer = await screen.findByRole('dialog', { name: 'Event Change History' });
    const newest = await within(drawer).findByTestId('audit-entry-2');
    expect(newest).toHaveTextContent('Technical Support One');
    expect(newest).toHaveTextContent('Coordinator');
    expect(newest).toHaveTextContent('Sarah Coordinator');
    expect(newest).toHaveTextContent('Raj Coordinator');
    expect(newest).toHaveTextContent('2 Oct 2026, 10:30 SGT');
    expect(within(drawer).getByTestId('audit-entry-1')).toHaveTextContent('(empty)');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/8/history', expect.anything());

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close change history' }));
    expect(screen.queryByRole('dialog', { name: 'Event Change History' })).not.toBeInTheDocument();
  });
});
