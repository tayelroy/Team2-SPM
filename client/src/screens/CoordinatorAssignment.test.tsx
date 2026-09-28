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
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    if (init?.method === 'PATCH') return patch(url, init);
    expect(url).toBe('/api/event-requests/assignable');
    return list();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('div')!.parentElement!.parentElement!;

describe('CoordinatorAssignment (SG2-33/34)', () => {
  test('lists requests, marking who is assigned and who is not', async () => {
    api();
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading requests…');

    await screen.findByRole('heading', { name: 'Partner Forum' });
    expect(within(card('Partner Forum')).getByText('Coordinator: Unassigned')).toBeInTheDocument();
    expect(within(card('Partner Forum')).getByText('E-7 · Acme')).toBeInTheDocument();
    expect(within(card('Partner Forum')).getByRole('button', { name: 'Assign' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Untitled request' })).toBeInTheDocument();
    expect(screen.getByText('E-8 · No organisation')).toBeInTheDocument();
    expect(screen.getByText('Coordinator: Sarah Coordinator')).toBeInTheDocument();
    // Already holds a coordinator, and nothing new chosen: nothing to save.
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeDisabled();
  });

  test('assigns a coordinator to an unassigned request (SG2-33)', async () => {
    const fetchMock = api();
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c2' } });
    fireEvent.click(within(card('Partner Forum')).getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Assigned to Raj Coordinator.')).toBeInTheDocument();
    expect(screen.getByText('Coordinator: Raj Coordinator')).toBeInTheDocument();
    expect(within(card('Partner Forum')).getByRole('button', { name: 'Reassign' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/event-requests/7/coordinator',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ coordinatorId: 'c2' }) }),
    );
  });

  test('reassigns a request to a different coordinator (SG2-34)', async () => {
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

  test('shows the reason and keeps the old coordinator when the save is refused', async () => {
    api(undefined, () => Response.json({ error: 'A coordinator can only be assigned to a submitted request.' }, { status: 409 }));
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c1' } });
    fireEvent.click(within(card('Partner Forum')).getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A coordinator can only be assigned to a submitted request.');
    expect(within(card('Partner Forum')).getByText('Coordinator: Unassigned')).toBeInTheDocument();
  });

  test('disables the button while a save is in flight', async () => {
    let finish!: (response: Response) => void;
    api(undefined, () => new Promise<Response>((resolve) => (finish = resolve)));
    render(<CoordinatorAssignment accessToken="tok" />);
    await screen.findByRole('heading', { name: 'Partner Forum' });

    fireEvent.change(screen.getByLabelText('Coordinator for Partner Forum'), { target: { value: 'c1' } });
    fireEvent.click(within(card('Partner Forum')).getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    finish(Response.json({ request: {} }));
    expect(await screen.findByText('Assigned to Sarah Coordinator.')).toBeInTheDocument();
  });

  test('offers a retry when requests cannot be loaded', async () => {
    let calls = 0;
    api(() => (++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ requests: REQUESTS, coordinators: COORDINATORS })));
    render(<CoordinatorAssignment accessToken="tok" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Requests are temporarily unavailable. Please try again later.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
  });

  test('explains a refusal to a signed-in account that is not Technical Support', async () => {
    api(() => new Response(null, { status: 403 }));
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only Technical Support Staff can assign coordinators.');
  });

  test('says so when there is nothing to assign', async () => {
    api(() => Response.json({ requests: [], coordinators: COORDINATORS }));
    render(<CoordinatorAssignment accessToken="tok" />);
    expect(await screen.findByRole('heading', { name: 'Nothing to assign' })).toBeInTheDocument();
  });

  test('ignores a response that arrives after the screen is closed', async () => {
    let resolve!: (response: Response) => void;
    api(() => new Promise<Response>((r) => (resolve = r)));
    const { unmount } = render(<CoordinatorAssignment accessToken="tok" />);
    unmount();
    resolve(Response.json({ requests: REQUESTS, coordinators: COORDINATORS }));
    await waitFor(() => expect(screen.queryByRole('heading')).not.toBeInTheDocument());
  });
});
