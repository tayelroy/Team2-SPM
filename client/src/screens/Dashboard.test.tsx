import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const requests = [
  { event_id: 1, name: 'My draft', status: 'draft', can_manage: true },
  { event_id: 2, name: 'Colleague draft', status: 'draft', can_manage: false },
  { event_id: 3, name: '', status: 'submitted', can_manage: true, coordinator_id: 'coord-1', coordinator_name: 'A. Coordinator' },
];

test('[NORMAL] [SG2-26:AC1] organisation dashboard shows real shared events, owned draft count and correct navigation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ requests }));
  vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={onNavigate} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
  await screen.findByText('Colleague draft');
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('1');
  expect(screen.getByText('Organisation events').closest('div')).toHaveTextContent('3');
  expect(screen.getByText('Waiting on me').closest('div')).toHaveTextContent('1');
  const shared = screen.getByRole('button', { name: /Colleague draft/ });
  expect(within(shared).getByText('View only')).toBeInTheDocument();
  fireEvent.click(shared);
  expect(onNavigate).toHaveBeenCalledWith('detail', 2);
  expect(screen.getByText('With coordinator')).toBeInTheDocument();
  expect(screen.getByText('Untitled event')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(onNavigate).toHaveBeenCalledWith('events');
  expect(fetch).toHaveBeenCalledWith('/api/event-requests', { method: 'GET', headers: { Authorization: 'Bearer token' } });
});

test('[NORMAL] [SG2-36:AC1] a request returned with a question counts as a draft and as waiting on me', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    ...requests, { event_id: 4, name: 'Returned forum', status: 'needs_clarification', can_manage: true },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByText('Returned forum');
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('2');
  expect(screen.getByText('Waiting on me').closest('div')).toHaveTextContent('2');
});

test.each([false, true])('[FAILURE] [SG2-26:AC1] unavailable organisation data never falls back to mock events (token %s)', async (hasToken) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" accessToken={hasToken ? 'token' : undefined} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('—');
});

test('[BOUNDARY] [SG2-26:AC1] empty organisation has explicit empty state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
});

test('[CONFLICT] [SG2-26:session-isolation] a late response for the previous session cannot replace the current organisation', async () => {
  let resolve!: (r: Response) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((yes) => { resolve = yes; }))
    .mockResolvedValueOnce(Response.json({ requests: [{ event_id: 9, name: 'Current organisation event', status: 'submitted' }] }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<Dashboard role="Event Organiser" accessToken="old-token" onNavigate={vi.fn()} />);
  rerender(<Dashboard role="Event Organiser" accessToken="new-token" onNavigate={vi.fn()} />);
  await screen.findByText('Current organisation event');
  await act(async () => resolve(Response.json({ requests })));
  expect(screen.getByText('Current organisation event')).toBeInTheDocument();
  expect(screen.queryByText('My draft')).not.toBeInTheDocument();
  expect(screen.getByText('Organisation events').closest('div')).toHaveTextContent('1');
});

test('[NORMAL] [SG2-20:prototype-dashboard] attendee retains its prototype event dashboard and navigation', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Attendee" onNavigate={onNavigate} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Registration open.*Quarterly Partner Dinner/ }));
  expect(onNavigate).toHaveBeenCalledWith('attendee');
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(onNavigate).toHaveBeenCalledWith('events');
  for (const button of screen.getAllByRole('button', { name: /^Open:/ })) fireEvent.click(button);
});

test('[NORMAL] [SG2-87:AC4] the organisation dashboard shows a queued request as awaiting assignment, not with a coordinator', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    { event_id: 5, name: 'Queued forum', status: 'unassigned', can_manage: true, coordinator_id: null },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  const card = await screen.findByRole('button', { name: /Queued forum/ });
  expect(within(card).getByText('Awaiting Assignment')).toBeInTheDocument();
  expect(within(card).getByText(/Unassigned/)).toBeInTheDocument();
  expect(within(card).getByText('Awaiting coordinator assignment')).toBeInTheDocument();
  expect(within(card).queryByText('With coordinator')).not.toBeInTheDocument();
});

// SG2-86: the Week 7 roles' desks carry no prototype events (E-205 etc.) and
// nothing on them opens an Attendee screen.
const prototypeEvents = ['Product Launch — Tideline', 'Northbridge Investor Forum', 'Quarterly Partner Dinner', 'Grad Recruitment Open Day'];
const queueEntry = (eventId: number) => ({ event_id: eventId, name: `Queued ${eventId}`, organiser_name: 'Org', proposed_date: null,
  expected_attendance: null, submitted_at: '2030-06-01T01:00:00Z' });

test('[NORMAL] [SG2-86:AC2] the Lead desk counts the real unassigned queue and opens only the Lead\'s queue', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ coordinators: [], entries: [queueEntry(41), queueEntry(42)] }));
  vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Event Coordinator Lead" accessToken="lead-token" onNavigate={onNavigate} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading the unassigned queue');
  expect(await screen.findByText('2 requests are awaiting a coordinator.')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/assignment-queue', { method: 'GET', headers: { Authorization: 'Bearer lead-token' } });
  for (const name of prototypeEvents) expect(screen.queryByText(name)).not.toBeInTheDocument();
  expect(screen.queryByText('Events needing attention')).not.toBeInTheDocument();
  expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Open unassigned queue']);
  fireEvent.click(screen.getByRole('button', { name: 'Open unassigned queue' }));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith('queue');
});

test.each([
  [[], '0 requests are awaiting a coordinator.'],
  [[queueEntry(41)], '1 request is awaiting a coordinator.'],
] as const)('[BOUNDARY] [SG2-86:AC2] the Lead desk counts a queue of %j exactly', async (entries, text) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ coordinators: [], entries })));
  render(<Dashboard role="Event Coordinator Lead" accessToken="lead-token" onNavigate={vi.fn()} />);
  expect(await screen.findByText(text)).toBeInTheDocument();
});

test.each([
  ['a refused request', 'lead-token', 403, 'Only the Event Coordinator Lead can see the unassigned queue.'],
  ['no session token', undefined, 200, 'Only the Event Coordinator Lead can see the unassigned queue.'],
  ['an unavailable queue', 'lead-token', 503, 'The unassigned queue is temporarily unavailable. Open it to try again.'],
] as const)('[FAILURE] [SG2-86:AC2] the Lead desk reports %s instead of falling back to prototype events', async (_, token, status, message) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator Lead" accessToken={token} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  for (const name of prototypeEvents) expect(screen.queryByText(name)).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(token ? 1 : 0);
});

test('[CONFLICT] [SG2-86:AC2] a late queue count for the previous session cannot replace the current one', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((yes) => { resolve = yes; }))
    .mockResolvedValueOnce(Response.json({ coordinators: [], entries: [queueEntry(41)] })));
  const { rerender } = render(<Dashboard role="Event Coordinator Lead" accessToken="old-token" onNavigate={vi.fn()} />);
  rerender(<Dashboard role="Event Coordinator Lead" accessToken="new-token" onNavigate={vi.fn()} />);
  await screen.findByText('1 request is awaiting a coordinator.');
  await act(async () => resolve(Response.json({ coordinators: [], entries: [queueEntry(41), queueEntry(42), queueEntry(43)] })));
  expect(screen.getByText('1 request is awaiting a coordinator.')).toBeInTheDocument();
});

test('[NORMAL] [SG2-86:AC2] the Safety Officer desk is an honest empty state with no events and nothing to open', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Safety Officer" accessToken="safety-token" onNavigate={onNavigate} />);
  expect(screen.getByRole('heading', { level: 2, name: 'No safety checks yet' })).toBeInTheDocument();
  expect(screen.getByText(/Safety checks arrive with the safety review flow/)).toBeInTheDocument();
  for (const name of prototypeEvents) expect(screen.queryByText(name)).not.toBeInTheDocument();
  expect(screen.queryByText('Events needing attention')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
});

test('[NORMAL] [SG2-38:AC2] [SG2-38:AC3] [SG2-31:AC4] each dashboard card says who the event is waiting on, in step with its status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    { event_id: 41, name: 'Queued forum', status: 'unassigned', can_manage: true, coordinator_id: null },
    { event_id: 42, name: 'Planning forum', status: 'planning', can_manage: true, coordinator_id: 'coord-1', coordinator_name: 'A. Coordinator' },
    { event_id: 44, name: 'Finished forum', status: 'completed', can_manage: true, coordinator_id: 'coord-1', coordinator_name: 'A. Coordinator' },
    { event_id: 45, name: 'Returned forum', status: 'needs_clarification', can_manage: true, coordinator_id: 'coord-1', coordinator_name: 'A. Coordinator' },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  const line = async (name: RegExp) => within(await screen.findByRole('button', { name })).getByText(
    /^(Awaiting coordinator assignment|With coordinator|No action needed|Waiting on you|View only)$/,
  );
  expect(await line(/Queued forum/)).toHaveTextContent('Awaiting coordinator assignment');
  expect(await line(/Planning forum/)).toHaveTextContent('With coordinator');
  expect(await line(/Finished forum/)).toHaveTextContent('No action needed');
  expect(await line(/Returned forum/)).toHaveTextContent('Waiting on you');
});

// Customer sources: Week 4 Q&A rows 5/38 permit revised resubmission; Week 9 row 11 requires changes through the coordinator.
test('[BOUNDARY] [SG2-31:AC4] [SG2-37:coordinator-led-revision] rejected requests do not count as waiting on the organiser while clarification still does', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    { event_id: 70, name: 'Rejected forum', status: 'rejected', can_manage: true, coordinator_id: 'coord-1' },
    { event_id: 71, name: 'Clarification forum', status: 'needs_clarification', can_manage: true, coordinator_id: 'coord-1' },
    { event_id: 72, name: 'Rejected colleague forum', status: 'rejected', can_manage: false, coordinator_id: 'coord-1' },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  const rejected = await screen.findByRole('button', { name: /Rejected forum/ });
  expect(within(rejected).getByText('Contact coordinator')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /Rejected colleague forum/ })).getByText('View only')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /Clarification forum/ })).getByText('Waiting on you')).toBeInTheDocument();
  expect(screen.getByText('Waiting on me').closest('div')).toHaveTextContent('1');
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('1');
});
