import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import Dashboard from './Dashboard';
import WorkQueue from './WorkQueue';

// Coordinators open events from the work queue, so SG2-92's decision summary
// is wired here. It has its own suite; this stub shows what the pane hands it
// and lets a test report a rework.
vi.mock('../components/SafetyDecisionSummary', () => ({
  default: ({ eventId, accessToken, status, canRework, onReworked }: {
    eventId: number; accessToken: string; status: string; canRework: boolean; onReworked: () => void;
  }) => (
    <section data-testid="safety-decision-summary">
      Safety for event {eventId} with {accessToken}, {status}, {canRework ? 'can rework' : 'read only'}
      <button type="button" onClick={onReworked}>Stub rework</button>
    </section>
  ),
}));
vi.mock('../components/ChangeRequestsPanel', () => ({ default: () => null }));
vi.mock('../components/ArrangementRechecks', () => ({ default: () => null }));
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/EventArrangements', () => ({ default: () => null }));
vi.mock('../venues/BookingClashes', () => ({ BookingClashes: () => null }));
// SG2-93: the staff panel has its own suite; this stub shows the token it is handed.
vi.mock('../components/SafetyRereviewQueue', () => ({
  default: ({ accessToken }: { accessToken: string }) => <section aria-label="Safety changes to confirm">Flags for {accessToken}</section>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rejected: WorkItem = {
  kind: 'event', item_id: 92, event_id: 92, title: 'Safety Forum', event_name: 'Safety Forum',
  status: 'safety_rejected', starts_at: '2030-06-15T02:00:00Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { organisation: 'Harbour Trust', expected_attendance: 120, registration_needed: false },
};

/** Serves the queue, then each re-read of the selected item from `items` in turn. */
function serveQueue(...items: WorkItem[]) {
  const reads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    reads.push(url);
    const selected = url.endsWith('/event/92');
    const index = Math.min(reads.filter((read) => read.endsWith('/event/92')).length - 1, items.length - 1);
    return Response.json({ items: [selected ? items[index] : items[0]] });
  }));
  return reads;
}

async function openForum() {
  render(<Dashboard role="Event Coordinator" accessToken="coordinator-token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Safety Forum/ }));
  return screen.findByRole('article', { name: 'Event request' });
}

describe('work queue safety decision (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC4] the assigned coordinator sees the decision on a Safety Rejected event and a rework re-reads it', async () => {
    const reads = serveQueue(rejected, { ...rejected, status: 'planning' });
    const pane = await openForum();
    expect(within(pane).getByTestId('safety-decision-summary'))
      .toHaveTextContent('Safety for event 92 with coordinator-token, safety_rejected, can rework');
    fireEvent.click(within(pane).getByRole('button', { name: 'Stub rework' }));
    const reloaded = await screen.findByRole('article', { name: 'Event request' });
    expect(await within(reloaded).findByText(/Safety for event 92 with coordinator-token, planning/)).toBeInTheDocument();
    expect(reads.filter((url) => url.endsWith('/event/92'))).toHaveLength(2);
  });

  test.each([
    ['not assigned to them', { assigned_to_me: false }],
    ['still approved, before any check', { status: 'approved' }],
    ['still under review', { status: 'under_review' }],
    ['completed', { status: 'completed' }],
  ])('[BOUNDARY] [SG2-92:AC6] an event %s shows no safety decision', async (_label, override) => {
    serveQueue({ ...rejected, ...override });
    const pane = await openForum();
    expect(within(pane).queryByTestId('safety-decision-summary')).not.toBeInTheDocument();
  });
});

describe('work queue safety changes to confirm (SG2-93)', () => {
  test.each(['Venue Staff', 'Technical Support Staff'] as const)(
    '[NORMAL] [SG2-93:AC2] %s see the safety changes to confirm above their queue, and not inside a request',
    async (role) => {
      serveQueue({ ...rejected, kind: role === 'Venue Staff' ? 'venue' : 'equipment', category: role === 'Venue Staff' ? 'venue' : 'equipment', title: 'Hall request' });
      render(<WorkQueue role={role} accessToken="staff-token" />);
      expect(screen.getByRole('region', { name: 'Safety changes to confirm' })).toHaveTextContent('Flags for staff-token');
      fireEvent.click(await screen.findByRole('button', { name: /Hall request/ }));
      await screen.findByRole('button', { name: /Back to work queue/ });
      expect(screen.queryByRole('region', { name: 'Safety changes to confirm' })).toBeNull();
    },
  );

  test.each([
    ['an Event Coordinator', 'Event Coordinator', 'coordinator-token', '1 item in your work queue'],
    ['staff without a session', 'Venue Staff', null, 'Sign in again to view your work queue.'],
  ] as const)('[BOUNDARY] [SG2-93:AC2] %s see no safety changes to confirm', async (_label, role, token, settled) => {
    serveQueue(rejected);
    render(<WorkQueue role={role} accessToken={token} />);
    expect(await screen.findByText(settled)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Safety changes to confirm' })).toBeNull();
  });
});
