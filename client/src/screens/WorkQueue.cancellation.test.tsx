import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import type { CancellationPanelProps } from '../components/CancellationPanel';
import Dashboard from './Dashboard';

// Coordinators open events from the work queue, so SG2-67's panel is wired
// here. It has its own suite; this stub shows what the pane hands it and lets
// a test report a cancellation.
vi.mock('../components/CancellationPanel', () => ({
  default: ({ eventId, accessToken, mode, status, requestedAt, reason, cancelledAt, onChanged }: CancellationPanelProps) => (
    <section data-testid="cancellation-panel">
      {`${eventId} ${accessToken} ${mode} ${status} ${requestedAt} ${reason} ${cancelledAt}`}
      <button type="button" onClick={onChanged}>Stub cancel</button>
    </section>
  ),
}));
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
  test('[NORMAL] [SG2-67:AC1] the assigned coordinator sees the organiser\'s request, and a cancellation re-reads the item', async () => {
    const reads = serveQueue(asked);
    const pane = await openForum();
    expect(within(pane).getByTestId('cancellation-panel')).toHaveTextContent(
      '67 coordinator-token coordinator planning 2026-10-21T01:00:00Z Speaker withdrew null');
    fireEvent.click(within(pane).getByRole('button', { name: 'Stub cancel' }));
    await vi.waitFor(() => expect(reads.filter((url) => url.endsWith('/event/67'))).toHaveLength(2));
  });

  test('[BOUNDARY] [SG2-67:AC1] with no request, or values that are not text, the panel gets nothing to act on', async () => {
    serveQueue({ ...asked, details: { organisation: 'Harbour Trust', cancellation_requested_at: 5, cancellation_reason: null } });
    const pane = await openForum();
    expect(within(pane).getByTestId('cancellation-panel')).toHaveTextContent('67 coordinator-token coordinator planning null null null');
  });

  test('[FAILURE] [SG2-67:AC1] an event not assigned to the coordinator shows no cancellation panel', async () => {
    serveQueue({ ...asked, assigned_to_me: false });
    const pane = await openForum();
    expect(within(pane).queryByTestId('cancellation-panel')).not.toBeInTheDocument();
  });
});
