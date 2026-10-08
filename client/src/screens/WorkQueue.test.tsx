import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import type { WorkItem } from '../api/workQueue';

vi.mock('../components/EquipmentRequirements', () => ({ default: ({ eventId }: { eventId: number }) => (
  <section aria-label="Equipment requirement integration">Equipment requests for event {eventId}</section>
) }));

// SG2-57: stubbed like EquipmentRequirements so its own fetch does not change
// the fetch counts and sequences these queue tests assert.
vi.mock('../components/EventArrangements', () => ({ default: ({ eventId }: { eventId: number }) => (
  <section aria-label="Arrangement readiness integration">Arrangements for event {eventId}</section>
) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const review: WorkItem = { kind: 'event', item_id: 12, event_id: 12, title: 'Leadership Forum',
  event_name: 'Leadership Forum', status: 'under_review', starts_at: '2030-06-15T02:00:00Z', ends_at: null,
  category: 'review', assigned_to_me: false, details: { purpose: 'Share ideas', description: 'A community forum',
    expected_attendance: 0, accessibility_needs: null, registration_needed: true } };

test.each(['approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'])('[NORMAL] [SG2-53:AC1] [SG2-53:AC5] [SG2-100:AC5] the assigned coordinator opens equipment requirements from a %s event', async status => {
  const item = { ...review, status, assigned_to_me: true, category: 'assigned' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [item] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  expect(await screen.findByRole('region', { name: 'Equipment requirement integration' })).toHaveTextContent('Equipment requests for event 12');
});

test('[NORMAL] [SG2-53:AC4] [SG2-53:AC5] support opens the equipment workflow for the selected queue request', async () => {
  const item = { ...review, kind: 'equipment', category: 'equipment', status: 'pending', item_id: 53, event_id: 91, title: 'Microphones' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [item] })));
  render(<Dashboard role="Technical Support Staff" accessToken="support-token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Microphones/ }));
  expect(await screen.findByRole('region', { name: 'Equipment requirement integration' })).toHaveTextContent('Equipment requests for event 91');
});

test.each([false, true])('[FAILURE] [SG2-53:AC1] equipment requirements are hidden before approval even when assigned: %s', async assigned_to_me => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ ...review, assigned_to_me }] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  expect(screen.queryByRole('region', { name: 'Equipment requirement integration' })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-41:AC4] coordinator queue groups distinct records, opens the exact assignment and refreshes when returning', async () => {
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

test('[BOUNDARY] [SG2-41:AC4] event detail preserves complete facts, zero, null and boolean values', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [review] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  for (const text of ['Share ideas', 'A community forum', '0', 'Not provided', 'Yes']) expect(screen.getByText(text, { exact: true })).toBeVisible();
  expect(screen.getByText(/15 Jun 2030, 10:00/)).toBeVisible();
});

test('[NORMAL] [SG2-35:AC2] opening a submitted request assigned to me moves it to under review (SG2-35)', async () => {
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

test('[CONFLICT] [SG2-35:AC3] [SG2-97:AC1] a request awaiting assignment is readable, never transitions, and names the Event Coordinator Lead as the assigner', async () => {
  const unassigned = { ...review, status: 'submitted', assigned_to_me: false };
  const fetch = vi.fn(async () => Response.json({ items: [unassigned] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  expect(await screen.findByText('Awaiting assignment. The Event Coordinator Lead assigns a coordinator before it can be reviewed.')).toBeVisible();
  expect(screen.getByText('submitted')).toBeVisible();
  expect(fetch).not.toHaveBeenCalledWith('/api/event-requests/12/review', expect.anything());
});

test('[CONFLICT] [SG2-35:review-isolation] a late review result cannot change the queue or a different selected request (SG2-35)', async () => {
  const submitted = { ...review, status: 'submitted', assigned_to_me: true };
  const another = { ...review, item_id: 28, event_id: 28, title: 'Another forum', status: 'submitted', assigned_to_me: false };
  let resolveReview!: (response: Response) => void;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? new Promise<Response>(yes => { resolveReview = yes; })
    : Response.json({ items: url.endsWith('/event/12') ? [submitted] : url.endsWith('/event/28') ? [another] : [submitted, another] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/review', expect.objectContaining({ method: 'PATCH' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  await screen.findByText('2 items in your work queue');
  fireEvent.click(screen.getByRole('button', { name: /Another forum/ }));
  expect(await screen.findByRole('heading', { name: 'Another forum' })).toBeVisible();
  await act(async () => resolveReview(Response.json({ request: { event_id: 12, status: 'under_review' } })));
  expect(screen.getByRole('heading', { name: 'Another forum' })).toBeVisible();
  expect(screen.getByText('submitted', { exact: true })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Decide this request' })).not.toBeInTheDocument();
  expect(screen.queryByText('under review')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  await screen.findByText('2 items in your work queue');
  expect(within(screen.getByRole('button', { name: /Another forum/ })).getByText('submitted')).toBeVisible();
});

test('[CONFLICT] [SG2-35:AC3] a review that cannot be started says so instead of claiming the status changed (SG2-35)', async () => {
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
] as const)('[NORMAL] [SG2-41:AC4] %s sees request identity, event and the exact time window', async (role, kind, group, title, detailLabel) => {
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
  // A venue request then also loads its suitability (SG2-47).
  expect(fetch).toHaveBeenCalledWith(`/api/work-queue/${kind}/7`, expect.anything());
});

test('[NORMAL] [SG2-48:AC2] Venue Staff see the layout, venue requirements and requester of a pending venue request', async () => {
  const request = { ...review, kind: 'venue', category: 'venue', item_id: 41, title: 'Atrium Hall', status: 'pending',
    ends_at: '2030-06-15T10:00:00Z', details: { venue_requirements: 'A stage', layout: 'theatre', requested_by: 'Casey Coordinator' } };
  const earlier = { ...request, item_id: 42, title: 'Quiet Room', details: { layout: null, requested_by: null } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/suitability') ? {}
    : { items: url.endsWith('/venue/41') ? [request] : url.endsWith('/venue/42') ? [earlier] : [request, earlier] })));
  render(<Dashboard role="Venue Staff" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Atrium Hall/ }));
  const detail = await screen.findByRole('article', { name: 'Venue booking request' });
  for (const [label, value] of [['Required layout', 'Theatre'], ['Venue requirements', 'A stage'], ['Requested by', 'Casey Coordinator']]) {
    expect(within(detail).getByText(label).nextElementSibling).toHaveTextContent(value);
  }
  expect(within(detail).getByText('pending')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
  fireEvent.click(await screen.findByRole('button', { name: /Quiet Room/ }));
  const legacy = await screen.findByRole('article', { name: 'Venue booking request' });
  expect(within(legacy).getByText('Required layout').nextElementSibling).toHaveTextContent('Not provided');
});

test('[FAILURE] [SG2-41:AC4] retry replaces an unavailable queue with explicit empty groups, then newly arrived work', async () => {
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

test('[CONFLICT] [SG2-41:session-isolation] a late result for the previous account cannot replace the new account queue', async () => {
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

test('[NORMAL] [SG2-39:AC1] coordinator can open and close the event planning drawer from item detail', async () => {
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

test('[NORMAL] [SG2-39:AC1] saving updates in event planning drawer updates item status and facts via onSuccess', async () => {
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

test('[CONFLICT] [SG2-39:AC5] Edit Planning Information button is hidden for terminal statuses and unassigned events', async () => {
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

/** SG2-37: only the coordinator actively reviewing a request decides it. */
const underReview = { ...review, status: 'under_review', assigned_to_me: true };

/** The body of the decision call, so tests assert what the server was told. */
function decisionBody(fetch: ReturnType<typeof vi.fn>) {
  const call = fetch.mock.calls.find(c => String(c[0]).endsWith('/decision'));
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
}

function decisionApi(onDecision?: (body: unknown) => Response) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/decision')) {
      return onDecision ? onDecision(JSON.parse(String(init?.body))) : Response.json({ request: { event_id: 12, status: 'approved' } });
    }
    if (typeof url === 'string' && url.endsWith('/clarifications')) return Response.json({ clarifications: [], status: 'under_review' });
    return Response.json({ items: [underReview] });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function openUnderReview() {
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  return screen.findByRole('region', { name: 'Decide this request' });
}

test('[NORMAL] [SG2-37:AC1] approving a request under review records the outcome and shows it (SG2-37)', async () => {
  const fetch = decisionApi();
  await openUnderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('approved')).toBeVisible();
  expect(decisionBody(fetch)).toEqual({ decision: 'approved', reason: '' });
});

test('[NORMAL] [SG2-37:AC2] rejecting sends the typed reason so the organiser learns why (SG2-37)', async () => {
  const fetch = decisionApi(() => Response.json({ request: { event_id: 12, status: 'rejected' } }));
  await openUnderReview();
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Clashes with the AGM.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(await screen.findByText('rejected')).toBeVisible();
  expect(decisionBody(fetch)).toEqual({ decision: 'rejected', reason: 'Clashes with the AGM.' });
});

test('[FAILURE] [SG2-37:AC2] a refused decision surfaces the reason and leaves the status alone (SG2-37)', async () => {
  decisionApi(() => Response.json({ error: 'A reason is required when rejecting an event request.' }, { status: 400 }));
  await openUnderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('reason is required');
  expect(screen.getByText('under review')).toBeVisible();
});

test('[CONFLICT] [SG2-37:duplicate-decision] decision buttons disable while a decision is in flight (SG2-37)', async () => {
  let settle!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { settle = resolve; });
  const fetch = vi.fn(async (url: string) => typeof url === 'string' && url.endsWith('/decision')
    ? pending
    : url.endsWith('/clarifications') ? Response.json({ clarifications: [], status: 'under_review' })
      : Response.json({ items: [underReview] }));
  vi.stubGlobal('fetch', fetch);
  await openUnderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
  const reject = screen.getByRole('button', { name: 'Reject' });
  expect(reject).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Approving…' }));
  fireEvent.click(reject);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/decision'))).toHaveLength(1);
  await act(async () => settle(Response.json({ request: { event_id: 12, status: 'approved' } })));
  expect(await screen.findByText('approved')).toBeVisible();
});

test('[FAILURE] [SG2-25:AC1] a request not assigned to me offers no decision at all (SG2-37)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ ...underReview, assigned_to_me: false }] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  expect(screen.queryByRole('region', { name: 'Decide this request' })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-46:AC1] an approved assigned event offers venue search pre-filled from the event (SG2-46)', async () => {
  decisionApi();
  const onFindVenues = vi.fn();
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} onFindVenues={onFindVenues} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  const approve = await screen.findByRole('button', { name: 'Approve' });
  expect(screen.queryByRole('button', { name: 'Find venues for this event' })).not.toBeInTheDocument();
  fireEvent.click(approve);
  fireEvent.click(await screen.findByRole('button', { name: 'Find venues for this event' }));
  expect(onFindVenues).toHaveBeenCalledWith(expect.objectContaining({
    eventId: underReview.event_id, eventName: underReview.title,
    values: expect.objectContaining({ from: '2030-06-15T00:00', until: '2030-06-15T23:59' })
  }));
});

test('[FAILURE] [SG2-46:AC1] an approved event that is not assigned to the coordinator has no venue search button', async () => {
  const approved = { ...review, status: 'approved', assigned_to_me: false };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [approved] })));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} onFindVenues={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  expect(screen.queryByRole('button', { name: 'Find venues for this event' })).not.toBeInTheDocument();
});

/** SG2-36: the reviewing coordinator can ask the organiser instead of deciding. */
const question = {
  clarification_id: 1, event_id: 12, sender_id: 'coordinator-1', sender_name: 'Casey Coordinator',
  message: 'Is the date firm?', created_at: '2030-05-01T02:00:00Z',
};

function clarificationApi(item: WorkItem, thread: unknown[], onPost: () => Response) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/clarifications')) {
      return init?.method === 'POST' ? onPost() : Response.json({ clarifications: thread, status: item.status });
    }
    return Response.json({ items: [item] });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-36:AC1] asking a question returns the request to the organiser and keeps the question', async () => {
  const fetch = clarificationApi(underReview, [], () => Response.json({ clarification: question, status: 'needs_clarification' }, { status: 201 }));
  await openUnderReview();
  const thread = await screen.findByRole('region', { name: 'Clarification conversation' });
  expect(await within(thread).findByText('No questions have been asked yet.')).toBeVisible();
  fireEvent.change(within(thread).getByLabelText('Ask the organiser a question'), { target: { value: 'Is the date firm?' } });
  fireEvent.click(within(thread).getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('needs clarification')).toBeVisible();
  expect(within(thread).getByText('Is the date firm?')).toBeVisible();
  expect(within(thread).getByLabelText('Add a follow-up question')).toHaveValue('');
  expect(screen.queryByRole('region', { name: 'Decide this request' })).not.toBeInTheDocument();
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/event-requests/12/clarifications');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ message: 'Is the date firm?' });
});

test('[NORMAL] [SG2-36:AC3] a returned request shows the earlier questions and allows a follow-up but no decision', async () => {
  clarificationApi({ ...underReview, status: 'needs_clarification' }, [question], () => Response.json({}));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  const thread = await screen.findByRole('region', { name: 'Clarification conversation' });
  expect(await within(thread).findByText('Is the date firm?')).toBeVisible();
  expect(within(thread).getByText('Casey Coordinator')).toBeVisible();
  expect(within(thread).getByLabelText('Add a follow-up question')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Decide this request' })).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-36:AC1] a refused question shows why and leaves the request under review', async () => {
  clarificationApi(underReview, [], () => Response.json({ error: 'A message is required.' }, { status: 400 }));
  await openUnderReview();
  const thread = await screen.findByRole('region', { name: 'Clarification conversation' });
  await within(thread).findByText('No questions have been asked yet.');
  fireEvent.click(within(thread).getByRole('button', { name: 'Send' }));
  expect(await within(thread).findByRole('alert')).toHaveTextContent('A message is required.');
  expect(screen.getByText('under review')).toBeVisible();
});

test.each([
  ['not assigned to me', { ...underReview, assigned_to_me: false }],
  ['already approved', { ...underReview, status: 'approved' }],
])('[CONFLICT] [SG2-36:AC1] a request %s offers no clarification thread', async (_label, item) => {
  const fetch = clarificationApi(item, [], () => Response.json({}));
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });
  expect(screen.queryByRole('region', { name: 'Clarification conversation' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/clarifications'))).toBe(false);
});

test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] coordinator opens the selected event history with its actor, timestamp and old/new values', async () => {
  const historyEntry = {
    log_id: 5, event_id: 12, actor_id: 'coord-9', actor_name: 'Priya Coordinator',
    field_name: 'expected_attendance', old_value: '50', new_value: '80',
    created_at: '2026-09-20T10:00:00.000Z',
  };
  const fetch = vi.fn(async (url: string) => url.endsWith('/history')
    ? Response.json({ event_id: 12, history: [historyEntry] })
    : Response.json({ items: [review] }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Leadership Forum/ }));
  await screen.findByRole('heading', { name: 'Leadership Forum' });

  const historyBtn = screen.getByRole('button', { name: 'View Change History' });
  expect(historyBtn).toBeInTheDocument();

  // Drawer not open yet
  expect(screen.queryByRole('dialog', { name: /change history/i })).not.toBeInTheDocument();

  // Open drawer
  fireEvent.click(historyBtn);
  expect(await screen.findByRole('dialog', { name: /change history/i })).toBeInTheDocument();

  // Valid history response is fetched with the correct URL and auth header, and renders the record.
  await screen.findByText('Priya Coordinator');
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/history', {
    headers: { Authorization: 'Bearer token' },
  });
  const entry = within(screen.getByTestId('audit-entry-5'));
  expect(entry.getByText('Priya Coordinator')).toBeInTheDocument();
  expect(entry.getByText('Expected Attendance')).toBeInTheDocument();
  expect(entry.getByText('20 Sept 2026, 18:00 SGT')).toBeInTheDocument();
  expect(entry.getByTestId('diff-old')).toHaveTextContent(/^50$/);
  expect(entry.getByTestId('diff-new')).toHaveTextContent(/^80$/);

  // Close drawer
  const closeBtn = screen.getByRole('button', { name: /close change history/i });
  fireEvent.click(closeBtn);
  expect(screen.queryByRole('dialog', { name: /change history/i })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-49:AC1] [SG2-49:AC3] Venue Staff approve a ready venue request from the work queue and see it recorded', async () => {
  const request = { ...review, kind: 'venue', category: 'venue', item_id: 41, title: 'Atrium Hall', status: 'pending',
    ends_at: '2030-06-15T10:00:00Z', details: { layout: 'theatre', requested_by: 'Casey Coordinator', hold_id: null } };
  const fit = { venue: { venue_id: 1, name: 'Atrium Hall', location: null, capacity: 400, suitability: { suitable: true, issues: [] } }, exceptions: [], booking: 'allowed' };
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/decision')) return Response.json({ request: { request_id: 41, event_id: 12, venue_id: 1, venue_name: 'Atrium Hall', status: 'approved',
      starts_at: '2030-06-15T02:00:00Z', ends_at: '2030-06-15T10:00:00Z', layout: 'theatre', venue_requirements: null, requester_name: 'Casey Coordinator',
      requested_at: '2030-01-01T00:00:00Z', decider_name: 'Vera', decided_at: '2030-01-02T00:00:00Z', decision_reason: null } });
    if (url.includes('/suitability')) return Response.json(fit);
    return Response.json({ items: [request] });
  });
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Venue Staff" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Atrium Hall/ }));
  const approve = await screen.findByRole('button', { name: 'Approve booking' });
  await vi.waitFor(() => expect(approve).toBeEnabled());
  fireEvent.click(approve);
  expect(await screen.findByText('Approved. The venue is committed to this event and the coordinator has been notified.')).toBeVisible();
  const detail = screen.getByRole('article', { name: 'Venue booking request' });
  expect(within(detail).getByText('approved')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/41/decision', expect.objectContaining({ method: 'POST' }));
});

test('[FAILURE] [SG2-49:AC1] a venue request created by a tentative hold is not decided from the work queue', async () => {
  const held = { ...review, kind: 'venue', category: 'venue', item_id: 44, title: 'Quiet Room', status: 'pending',
    ends_at: '2030-06-15T10:00:00Z', details: { layout: null, requested_by: null, hold_id: 12 } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/suitability') ? {} : { items: [held] })));
  render(<Dashboard role="Venue Staff" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Quiet Room/ }));
  expect(await screen.findByText('This request belongs to tentative hold #12. Convert or release it from Venue holds.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
});

// SG2-100 AC4: the coordinator closes out a held event from their own work
// queue. `ends_at` is the latest of the event's confirmed venue bookings
// (internal_work_items); only Date is faked, so findBy* polling still runs.
const NOW = '2030-06-15T12:00:00.000Z';
const held: WorkItem = { ...review, item_id: 28, event_id: 28, title: 'Held Forum', category: 'assigned',
  status: 'confirmed', assigned_to_me: true, ends_at: '2030-06-15T10:00:00.000Z' };

function completionFetch(item: WorkItem, complete: () => Promise<Response> | Response) {
  return vi.fn(async (url: string, init?: RequestInit) => init?.method === 'PATCH' && url.endsWith('/complete')
    ? complete()
    : Response.json({ items: [item] }));
}

async function openHeld(item: WorkItem, fetch: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(item.title) }));
  await screen.findByRole('heading', { name: item.title });
}

test('[NORMAL] [SG2-100:AC6] the assigned coordinator marks a held event completed from the work queue', async () => {
  const fetch = completionFetch(held, () => Response.json({ request: { event_id: 28, status: 'completed' } }));
  await openHeld(held, fetch);
  expect(screen.getByText(/This event ended on 15 Jun 2030, 18:00 \(Singapore time\)/)).toBeVisible();
  // The proposed date and the booking end come from different records, so
  // they are never shown as one range.
  expect(screen.queryByText(/ – 15 Jun 2030, 18:00/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as Completed' }));
  expect(await screen.findByText('Marked as completed. This event has left your active work queue.')).toBeVisible();
  expect(screen.getByText('completed', { exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mark as Completed' })).not.toBeInTheDocument();
  // A completed event is read-only, so planning can no longer be edited.
  expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/28/complete', {
    method: 'PATCH', headers: { Authorization: 'Bearer token' },
  });
});

test('[NORMAL] [SG2-100:AC6] an event in preparation can also be marked completed once held', async () => {
  const preparation = { ...held, status: 'preparation' };
  await openHeld(preparation, completionFetch(preparation, () => Response.json({})));
  expect(screen.getByText('preparation', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mark as Completed' })).toBeEnabled();
});

test('[BOUNDARY] [SG2-100:AC6] completion is offered from the exact end time, never before it or with no confirmed booking', async () => {
  for (const [ends_at, offered] of [[NOW, true], ['2030-06-15T12:00:00.001Z', false], [null, false]] as const) {
    const item = { ...held, ends_at };
    await openHeld(item, completionFetch(item, () => Response.json({})));
    expect(screen.queryByRole('button', { name: 'Mark as Completed' }) !== null).toBe(offered);
    cleanup();
  }
});

test('[CONFLICT] [SG2-100:AC6] a rapid double-click sends one completion and disables the button while it is in flight', async () => {
  let resolve!: (response: Response) => void;
  const fetch = completionFetch(held, () => new Promise<Response>(yes => { resolve = yes; }));
  await openHeld(held, fetch);
  const button = screen.getByRole('button', { name: 'Mark as Completed' });
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Marking as Completed…' })).toBeDisabled();
  await act(async () => resolve(Response.json({ request: { event_id: 28, status: 'completed' } })));
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1);
});

test('[FAILURE] [SG2-100:AC6] a refused completion is explained and leaves the action available to retry', async () => {
  await openHeld(held, completionFetch(held, () => Response.json({ error: 'This event has not finished yet.' }, { status: 409 })));
  fireEvent.click(screen.getByRole('button', { name: 'Mark as Completed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This event has not finished yet.');
  expect(screen.getByRole('button', { name: 'Mark as Completed' })).toBeEnabled();
  expect(screen.getByText('confirmed', { exact: true })).toBeVisible();
});

test('[FAILURE] [SG2-100:AC6] completion is never offered on someone else\'s event or before the event is confirmed or in preparation', async () => {
  for (const item of [{ ...held, assigned_to_me: false }, { ...held, status: 'approved' }, { ...held, status: 'planning' }]) {
    await openHeld(item, completionFetch(item, () => Response.json({})));
    expect(screen.queryByRole('button', { name: 'Mark as Completed' })).not.toBeInTheDocument();
    cleanup();
  }
});
