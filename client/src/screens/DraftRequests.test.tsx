import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import DraftRequests from './DraftRequests';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function api(requests: unknown[] = [], details: Record<number, unknown> = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    if (url === '/api/event-requests?scope=mine' && (init?.method ?? 'GET') === 'GET') {
      return Response.json({ requests });
    }
    const detailMatch = typeof url === 'string' && url.match(/^\/api\/event-requests\/(\d+)$/);
    if (detailMatch && (init?.method ?? 'GET') === 'GET') {
      const eventId = Number(detailMatch[1]);
      const request = details[eventId];
      if (!request) return new Response(null, { status: 404 });
      return Response.json({ request });
    }
    if (typeof url === 'string' && url.startsWith('/api/event-requests/') && init?.method === 'DELETE') {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const DRAFT = { event_id: 7, status: 'draft', name: 'Partner Forum' };
const SUBMITTED = { event_id: 8, status: 'submitted', name: 'Board Offsite' };
const DRAFT_FULL_RECORD = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'draft',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Half-day forum with keynotes and a reception.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: 'Hearing loop',
  equipment_requirements: 'Lectern, 2 radio mics',
  registration_needed: true
};

test('no token never loads data', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<DraftRequests onEdit={noop} />);
  expect(screen.getByText(/Sign in with your account/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('shows loading, then the empty state when the caller has no requests', async () => {
  const fetch = api([]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your requests');
  expect(await screen.findByRole('heading', { name: 'No event requests yet' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/event-requests?scope=mine', { headers: { Authorization: 'Bearer test-token' } });
});

test('lists requests and only offers Edit/Delete on drafts', async () => {
  api([DRAFT, SUBMITTED]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  expect(await screen.findByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Board Offsite' })).toBeInTheDocument();
  expect(screen.getByText('Draft')).toBeInTheDocument();
  expect(screen.getByText('Submitted')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
});

test('Edit fetches the full record (not just the list summary) before handing it to onEdit', async () => {
  const fetch = api([DRAFT, SUBMITTED], { 7: DRAFT_FULL_RECORD });
  const detail = deferred<Response>();
  const onEdit = vi.fn();
  render(<DraftRequests accessToken="test-token" onEdit={onEdit} />);
  const editButton = await screen.findByRole('button', { name: 'Edit' });
  fetch.mockImplementationOnce(() => detail.promise);
  fireEvent.click(editButton);
  expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled();
  expect(onEdit).not.toHaveBeenCalled();
  await act(async () => detail.resolve(Response.json({ request: DRAFT_FULL_RECORD })));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(onEdit).toHaveBeenCalledWith(DRAFT_FULL_RECORD);
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/7', {
    headers: { Authorization: 'Bearer test-token' }
  });
});

test('a failed edit fetch shows an error instead of opening a half-blank form', async () => {
  api([DRAFT]);
  const onEdit = vi.fn();
  render(<DraftRequests accessToken="test-token" onEdit={onEdit} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
});

test('Edit is hidden once a delete confirmation is showing for that draft', async () => {
  api([DRAFT]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});

test('falls back to "Untitled request" when the name is blank', async () => {
  api([{ event_id: 9, status: 'draft', name: '  ' }]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  expect(await screen.findByRole('heading', { name: 'Untitled request' })).toBeInTheDocument();
});

test('deleting a draft requires confirmation, and Cancel backs out without calling the API', async () => {
  const fetch = api([DRAFT]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(screen.getByRole('alert')).toHaveTextContent("Delete this draft? This can't be undone.");
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('confirming delete removes the request and disables the buttons while in flight', async () => {
  const fetch = api([DRAFT]);
  const del = deferred<Response>();
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  fetch.mockImplementationOnce(() => del.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => del.resolve(new Response(null, { status: 200 })));
  expect(screen.queryByRole('heading', { name: 'Partner Forum' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/7', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer test-token' }
  });
});

test('a failed delete shows an error and keeps the request in the list', async () => {
  const fetch = api([DRAFT]);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  fetch.mockImplementationOnce(async () => new Response(null, { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText('Only a draft request can be deleted.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
});

test('clicking Delete on a different draft clears an existing delete error', async () => {
  const DRAFT_TWO = { event_id: 10, status: 'draft', name: 'Second Draft' };
  // A failed delete on DRAFT leaves it in the confirm state (its own "Confirm
  // delete"/"Cancel", not "Delete") — starting a fresh delete on DRAFT_TWO is
  // the only remaining "Delete" button, and should clear the stale error.
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/event-requests?scope=mine' && (init?.method ?? 'GET') === 'GET') {
      return Response.json({ requests: [DRAFT, DRAFT_TWO] });
    }
    if (url === '/api/event-requests/7' && init?.method === 'DELETE') {
      return new Response(null, { status: 503 });
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' });
  fireEvent.click(deleteButtons[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText('Could not reach the server. Please try again.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.queryByText('Could not reach the server. Please try again.')).not.toBeInTheDocument();
});

test('a load failure offers retry and recovers', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
  fetch.mockResolvedValueOnce(Response.json({ requests: [DRAFT] }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Partner Forum' })).toBeInTheDocument();
});

test('a stale successful load cannot restore another user’s requests', async () => {
  const load = deferred<Response>();
  const fetch = vi.fn(() => load.promise);
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<DraftRequests accessToken="test-token" onEdit={noop} />);
  rerender(<DraftRequests accessToken={null} onEdit={noop} />);
  await act(async () => load.resolve(Response.json({ requests: [DRAFT] })));
  expect(screen.queryByRole('heading', { name: 'Partner Forum' })).not.toBeInTheDocument();
});
