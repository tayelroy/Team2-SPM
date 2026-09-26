import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import type { WorkItem } from '../api/workQueue';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const review: WorkItem = { kind: 'event', item_id: 12, event_id: 12, title: 'Leadership Forum',
  event_name: 'Leadership Forum', status: 'under_review', starts_at: '2030-06-15T02:00:00Z', ends_at: null,
  category: 'review', assigned_to_me: false, details: { purpose: 'Share ideas', description: 'A community forum',
    expected_attendance: 0, accessibility_needs: null, registration_needed: true } };

test('coordinator queue groups distinct records, opens the exact assignment and refreshes when returning', async () => {
  const assigned = { ...review, item_id: 28, event_id: 28, title: 'Assigned workshop', category: 'assigned', status: 'planning',
    starts_at: null, details: { organisation: 'Harbour Trust', registration_needed: false } };
  const fetch = vi.fn(async (url: string) => Response.json({ items: url.endsWith('/event/28') ? [assigned] : [review, assigned] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  await screen.findByText('2 items in your work queue');
  expect(within(screen.getByRole('region', { name: 'Awaiting review' })).getByText('Leadership Forum', { selector: 'strong' })).toBeVisible();
  // Event cards name the organisation rather than repeating the title.
  expect(screen.getByText('Organisation not provided · Event #12')).toBeVisible();
  expect(screen.getByText('Harbour Trust · Event #28')).toBeVisible();
  expect(screen.queryByText('Leadership Forum · Event #12')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: 'My assigned events' })).getByRole('button'));
  expect(await screen.findByRole('heading', { name: 'Assigned workshop' })).toHaveFocus();
  expect(screen.getByText('Harbour Trust · Event #28')).toBeVisible();
  expect(screen.getByText('No', { exact: true })).toBeVisible();
  expect(screen.getByText(/Date not set/)).toBeVisible();
  expect(fetch).toHaveBeenLastCalledWith('/api/work-queue/event/28', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  await screen.findByText('2 items in your work queue');
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('event detail preserves complete facts, zero, null and boolean values', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [review] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  for (const text of ['Share ideas', 'A community forum', '0', 'Not provided', 'Yes']) expect(screen.getByText(text, { exact: true })).toBeVisible();
  expect(screen.getByText(/15 Jun 2030, 10:00/)).toBeVisible();
});

test('opening a submitted request assigned to me moves it to under review (SG2-35)', async () => {
  const submitted = { ...review, status: 'submitted', assigned_to_me: true };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? Response.json({ request: { event_id: 12, status: 'under_review' } })
    : Response.json({ items: [submitted] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  expect(await screen.findByText('under review')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/review', {
    method: 'PATCH', headers: { Authorization: 'Bearer token' },
  });
});

test('a request awaiting assignment is readable but never transitions (SG2-35)', async () => {
  const unassigned = { ...review, status: 'submitted', assigned_to_me: false };
  const fetch = vi.fn(async () => Response.json({ items: [unassigned] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  expect(await screen.findByText(/Awaiting assignment/)).toBeVisible();
  expect(screen.getByText('submitted')).toBeVisible();
  expect(fetch).not.toHaveBeenCalledWith('/api/event-requests/12/review', expect.anything());
});

test('a review result arriving after leaving the request is ignored (SG2-35)', async () => {
  const submitted = { ...review, status: 'submitted', assigned_to_me: true };
  let resolveReview!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? new Promise<Response>(yes => { resolveReview = yes; })
    : Response.json({ items: [submitted] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  await screen.findByText('1 item in your work queue');
  await act(async () => resolveReview(Response.json({ request: { event_id: 12, status: 'under_review' } })));
  expect(screen.queryByText('under review')).not.toBeInTheDocument();
});

test('a review that cannot be started says so instead of claiming the status changed (SG2-35)', async () => {
  const submitted = { ...review, status: 'submitted', assigned_to_me: true };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? new Response(null, { status: 404 }) : Response.json({ items: [submitted] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer assigned to you');
  expect(screen.getByText('submitted')).toBeVisible();
});

test.each([
  ['Venue Staff', 'venue', 'Booking requests awaiting decision', 'Atrium Hall', 'Venue booking request'],
  ['Technical Support Staff', 'equipment', 'Equipment requests awaiting decision', 'Wireless microphone', 'Equipment request'],
] as const)('%s sees request identity, event and the exact time window', async (role, kind, group, title, detailLabel) => {
  const item = { ...review, kind, category: kind, item_id: 7, title, ends_at: '2030-06-15T06:00:00Z', details: { quantity: 2, notes: 'Set up before doors open' } };
  const fetch = vi.fn(async () => Response.json({ items: [item] })); vi.stubGlobal('fetch', fetch);
  render(<Dashboard role={role} accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByRole('region', { name: group });
  expect(screen.queryByRole('region', { name: 'Awaiting review' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
  const detail = await screen.findByRole('article', { name: detailLabel });
  expect(within(detail).getByText('Leadership Forum · Event #12')).toBeVisible();
  expect(within(detail).getByText(/14:00/)).toBeVisible();
  expect(screen.getByText('Set up before doors open')).toBeVisible();
  expect(fetch).toHaveBeenLastCalledWith(`/api/work-queue/${kind}/7`, expect.anything());
});

test('retry replaces an unavailable queue with explicit empty groups, then newly arrived work', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ items: [] })).mockResolvedValueOnce(Response.json({ items: [review] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByText('0 items in your work queue')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('0 items in your work queue');
  expect(screen.getAllByText('You’re all caught up. No items here.')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('1 item in your work queue');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a late result for the previous account cannot replace the new account queue', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; }))
    .mockResolvedValueOnce(Response.json({ items: [] })));
  const { rerender } = render(<Dashboard role="Event Coordinator" accessToken="old" onNavigate={vi.fn()} />);
  rerender(<Dashboard role="Venue Staff" accessToken="new" onNavigate={vi.fn()} />);
  await screen.findByText('0 items in your work queue');
  await act(async () => resolve(Response.json({ items: [review] })));
  expect(screen.queryByText('Leadership Forum')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Booking requests awaiting decision' })).toBeVisible();
});

test('coordinator can open and close the event planning drawer from item detail', async () => {
  const assigned: WorkItem = {
    ...review,
    item_id: 28,
    event_id: 28,
    title: 'Assigned workshop',
    category: 'assigned',
    status: 'planning',
    assigned_to_me: true,
    starts_at: '2030-06-15T02:00:00Z',
    details: {
      organisation: 'Harbour Trust',
      registration_needed: true,
      expected_attendance: 50,
      venue_requirements: 'Hall A',
      equipment_requirements: 'Projector',
      accessibility_needs: 'Wheelchair access',
      registration_capacity: 100,
      registration_opens_at: '2030-05-01T00:00:00Z',
      registration_closes_at: '2030-06-01T00:00:00Z',
      planning_notes: 'Priority VIP',
    },
  };
  const fetch = vi.fn(async (url: string) =>
    Response.json({ items: url.endsWith('/event/28') ? [assigned] : [assigned] })
  );
  vi.stubGlobal('fetch', fetch);

  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByText('1 item in your work queue');
  fireEvent.click(screen.getByRole('button', { name: /Assigned workshop/ }));

  expect(await screen.findByRole('heading', { name: 'Assigned workshop' })).toBeInTheDocument();
  const editBtn = screen.getByRole('button', { name: 'Edit Planning Information' });
  expect(editBtn).toBeVisible();

  fireEvent.click(editBtn);
  const drawer = await screen.findByRole('dialog', { name: 'Event Planning Details' });
  expect(drawer).toBeInTheDocument();

  const closeBtn = screen.getByRole('button', { name: 'Close planning drawer' });
  fireEvent.click(closeBtn);
  expect(screen.queryByRole('dialog', { name: 'Event Planning Details' })).not.toBeInTheDocument();
});

test('saving updates in event planning drawer updates item status and facts via onSuccess', async () => {
  const assigned: WorkItem = {
    ...review,
    item_id: 28,
    event_id: 28,
    title: 'Assigned workshop',
    category: 'assigned',
    status: 'planning',
    assigned_to_me: true,
    starts_at: '2030-06-15T02:00:00Z',
    details: {
      organisation: 'Harbour Trust',
      registration_needed: false,
    },
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' && url.includes('/planning')) {
      return Response.json({
        event: {
          event_id: 28,
          status: 'planning_in_progress',
          proposed_date: '2030-07-20T04:00:00.000Z',
          expected_attendance: 120,
          venue_requirements: 'Grand Ballroom',
          equipment_requirements: 'PA System',
          accessibility_needs: 'Elevator access',
          registration_needed: true,
          registration_capacity: 200,
          registration_opens_at: '2030-06-01T00:00:00.000Z',
          registration_closes_at: '2030-07-01T00:00:00.000Z',
          planning_notes: 'Catering requested',
          arrangements_recheck_needed: true,
          outstanding_arrangements: ['venue_recheck'],
        },
      });
    }
    return Response.json({ items: [assigned] });
  });
  vi.stubGlobal('fetch', fetch);

  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByText('1 item in your work queue');
  fireEvent.click(screen.getByRole('button', { name: /Assigned workshop/ }));

  expect(await screen.findByRole('heading', { name: 'Assigned workshop' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));

  await screen.findByRole('dialog', { name: 'Event Planning Details' });

  const saveBtn = screen.getByRole('button', { name: 'Save Planning Details' });
  fireEvent.click(saveBtn);

  await expect(screen.findByText('planning in progress')).resolves.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Event Planning Details' })).not.toBeInTheDocument();
  expect(screen.getByText('120')).toBeVisible();
  expect(screen.getByText('Grand Ballroom')).toBeVisible();
  expect(screen.getByText('PA System')).toBeVisible();
});

test('Edit Planning Information button is hidden for terminal statuses and unassigned events', async () => {
  const cancelled: WorkItem = {
    ...review,
    item_id: 31,
    event_id: 31,
    title: 'Cancelled Gala',
    status: 'cancelled',
    assigned_to_me: true,
  };
  const unassigned: WorkItem = {
    ...review,
    item_id: 32,
    event_id: 32,
    title: 'Unassigned Gala',
    status: 'submitted',
    assigned_to_me: false,
  };
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/event/31')) return Response.json({ items: [cancelled] });
    if (url.endsWith('/event/32')) return Response.json({ items: [unassigned] });
    return Response.json({ items: [cancelled, unassigned] });
  });
  vi.stubGlobal('fetch', fetch);

  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByText('2 items in your work queue');

  fireEvent.click(screen.getByRole('button', { name: /Cancelled Gala/ }));
  expect(await screen.findByRole('heading', { name: 'Cancelled Gala' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  await screen.findByText('2 items in your work queue');
  fireEvent.click(screen.getByRole('button', { name: /Unassigned Gala/ }));
  expect(await screen.findByRole('heading', { name: 'Unassigned Gala' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
});
