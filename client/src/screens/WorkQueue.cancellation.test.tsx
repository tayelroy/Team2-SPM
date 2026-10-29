import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import Dashboard from './Dashboard';

// Keep the real cancellation panel here: the queue must preserve its success
// receipt when the server removes the cancelled event from active work.
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));
vi.mock('../components/ChangeRequestsPanel', () => ({ default: () => null }));
vi.mock('../components/ArrangementRechecks', () => ({ default: () => null }));
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/EventArrangements', () => ({ default: () => null }));
vi.mock('../venues/BookingClashes', () => ({ BookingClashes: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asked: WorkItem = {
  kind: 'event', item_id: 67, event_id: 67, title: 'Cancel Forum', event_name: 'Cancel Forum',
  status: 'planning', starts_at: '2030-06-15T02:00:00Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { organisation: 'Harbour Trust', registration_needed: false,
    cancellation_requested_at: '2026-10-21T01:00:00Z', cancellation_reason: 'Speaker withdrew' },
};

function serveQueue(item: WorkItem) {
  const reads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    reads.push(url);
    return Response.json({ items: [item] });
  }));
  return reads;
}

async function openForum() {
  render(<Dashboard role="Event Coordinator" accessToken="coordinator-token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Cancel Forum/ }));
  return screen.findByRole('article', { name: 'Event request' });
}

describe('work queue cancellation (SG2-67)', () => {
  test('[NORMAL] [SG2-67:AC1] [SG2-67:AC4] [SG2-67:AC5] a successful cancellation keeps its final timestamp and receipt until returning to the empty queue', async () => {
    let cancelled = false;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/cancel')) {
        cancelled = true;
        return Response.json({ cancelled_at: '2026-10-29T07:00:00Z', bookings_released: 1, attendees_notified: 2 });
      }
      if (cancelled && url.endsWith('/event/67')) return new Response(null, { status: 404 });
      return Response.json({ items: cancelled ? [] : [asked] });
    });
    vi.stubGlobal('fetch', fetch);
    const pane = await openForum();
    expect(within(pane).getByRole('region', { name: 'Cancellation' })).toHaveTextContent('The organiser asked to cancel this event');
    fireEvent.click(within(pane).getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(within(pane).getByRole('button', { name: 'Yes, cancel event' }));
    expect(await within(pane).findByRole('status')).toHaveTextContent('This event was cancelled on 29 Oct 2026, 15:00 SGT. Reason: Speaker withdrew A similar event needs a new request.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/67/cancel', expect.objectContaining({ method: 'PATCH', headers: { Authorization: 'Bearer coordinator-token' } }));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/event/67'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to work queue' }));
    expect(await screen.findByRole('status')).toHaveTextContent('0 items in your work queue');
    expect(screen.queryByRole('button', { name: /Cancel Forum/ })).not.toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-67:AC1] with no request, or values that are not text, the panel gets nothing to act on', async () => {
    serveQueue({ ...asked, details: { organisation: 'Harbour Trust', cancellation_requested_at: 5, cancellation_reason: null } });
    const pane = await openForum();
    expect(within(pane).queryByRole('region', { name: 'Cancellation' })).not.toBeInTheDocument();
  });

  test('[FAILURE] [SG2-67:AC1] an event not assigned to the coordinator shows no cancellation panel', async () => {
    serveQueue({ ...asked, assigned_to_me: false });
    const pane = await openForum();
    expect(within(pane).queryByRole('region', { name: 'Cancellation' })).not.toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-96:stale-work-item] refreshing an event removed elsewhere still reports that it left the queue', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [asked] }));
    vi.stubGlobal('fetch', fetch);
    await openForum();
    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This item is no longer in your work queue. Return to the queue to refresh it.');
    expect(screen.queryByText('This event was cancelled.')).not.toBeInTheDocument();
  });
});
