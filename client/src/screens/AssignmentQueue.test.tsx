import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AssignmentQueue from './AssignmentQueue';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const COORDS = [{ user_id: 'c1', name: 'Casey Coordinator' }, { user_id: 'c2', name: 'Robin Second' }];
const RAW = { event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia', proposed_date: null, expected_attendance: 10, submitted_at: null };

/** A fresh Response per call: React StrictMode runs effects twice. */
function api(reply: () => Response) {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('AssignmentQueue (SG2-87)', () => {
  test('[NORMAL] [SG2-87:AC3] each entry shows its name, organiser, proposed date and time, attendance and submitted date', async () => {
    api(() => Response.json({ coordinators: COORDS, entries: [{
      event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia Organiser',
      proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120, submitted_at: '2026-10-06T01:30:00.000Z',
    }] }));
    render(<AssignmentQueue accessToken="tok" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the unassigned queue…');
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    expect(within(entry).getByText('Olivia Organiser')).toBeInTheDocument();
    expect(within(entry).getByText('15 Jun 2030, 10:00 am')).toBeInTheDocument();
    expect(within(entry).getByText('120')).toBeInTheDocument();
    expect(within(entry).getByText('6 Oct 2026, 9:30 am')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '1 request awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-87:AC3] missing details read Not recorded, an empty name reads Untitled request, and the count pluralises', async () => {
    api(() => Response.json({ coordinators: COORDS, entries: [
      { event_id: 2, name: '  ', organiser_name: null, proposed_date: null, expected_attendance: null, submitted_at: null },
      { event_id: 3, name: 'Second', organiser_name: 'Oscar', proposed_date: null, expected_attendance: 0, submitted_at: null },
    ] }));
    render(<AssignmentQueue accessToken="tok" />);
    const untitled = await screen.findByRole('article', { name: 'Untitled request' });
    expect(within(untitled).getAllByText('Not recorded')).toHaveLength(4);
    expect(within(screen.getByRole('article', { name: 'Second' })).getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2 requests awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-87:AC5] an empty queue says nothing is waiting', async () => {
    api(() => Response.json({ entries: [], coordinators: COORDS }));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('heading', { name: 'No requests awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-87:AC2] an account that is not the Lead is told so', async () => {
    api(() => new Response(null, { status: 403 }));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the Event Coordinator Lead can see the unassigned queue.');
  });

  test('[FAILURE] [SG2-87:AC2] an unavailable queue can be retried', async () => {
    let healthy = false;
    api(() => (healthy ? Response.json({ entries: [], coordinators: COORDS }) : new Response(null, { status: 503 })));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The unassigned queue is temporarily unavailable. Please try again.');
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No requests awaiting a coordinator' })).toBeInTheDocument();
  });

  /** Routes the queue read and the assign write separately; a fresh Response per call. */
  function assignApi(assign: () => Response) {
    const fetch = vi.fn().mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'PATCH' ? assign() : Response.json({ coordinators: COORDS, entries: [RAW, { ...RAW, event_id: 2, name: 'Second Forum' }] })));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  test('[NORMAL] [SG2-88:AC1] picking a coordinator and assigning sends the assignment and takes the request out of the queue', async () => {
    const fetch = assignApi(() => Response.json({ request: {} }));
    render(<AssignmentQueue accessToken="tok" />);
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    expect(within(entry).getByRole('button', { name: 'Assign Leadership Forum' })).toBeDisabled();
    fireEvent.change(within(entry).getByLabelText('Coordinator for Leadership Forum'), { target: { value: 'c2' } });
    fireEvent.click(within(entry).getByRole('button', { name: 'Assign Leadership Forum' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Assigned Leadership Forum to Robin Second.');
    expect(screen.queryByRole('article', { name: 'Leadership Forum' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Second Forum' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/1/coordinator', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ coordinatorId: 'c2' }),
    }));
    expect(screen.getByRole('heading', { level: 2, name: '1 request awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-88:AC1] a refused assignment keeps the request in the queue and shows why', async () => {
    assignApi(() => Response.json({ error: 'This request was assigned by someone else.' }, { status: 409 }));
    render(<AssignmentQueue accessToken="tok" />);
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    fireEvent.change(within(entry).getByLabelText('Coordinator for Leadership Forum'), { target: { value: 'c1' } });
    fireEvent.click(within(entry).getByRole('button', { name: 'Assign Leadership Forum' }));
    expect(await within(entry).findByRole('alert')).toHaveTextContent('This request was assigned by someone else.');
    expect(screen.getByRole('article', { name: 'Leadership Forum' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-88:AC1] with no coordinators to pick, the picker says so and Assign stays disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ coordinators: [], entries: [RAW] }))));
    render(<AssignmentQueue accessToken="tok" />);
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    expect(within(entry).getByRole('option', { name: 'No coordinators available' })).toBeInTheDocument();
    expect(within(entry).getByLabelText('Coordinator for Leadership Forum')).toBeDisabled();
    expect(within(entry).getByRole('button', { name: 'Assign Leadership Forum' })).toBeDisabled();
  });

  test('[BOUNDARY] [SG2-88:AC1] assigning the last request still confirms it on the empty-queue screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'PATCH' ? Response.json({ request: {} })
        : Response.json({ coordinators: COORDS, entries: [RAW] }))));
    render(<AssignmentQueue accessToken="tok" />);
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    fireEvent.change(within(entry).getByLabelText('Coordinator for Leadership Forum'), { target: { value: 'c1' } });
    fireEvent.click(within(entry).getByRole('button', { name: 'Assign Leadership Forum' }));
    expect(await screen.findByRole('heading', { name: 'No requests awaiting a coordinator' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Assigned Leadership Forum to Casey Coordinator.');
  });


});
