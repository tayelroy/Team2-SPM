import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import Dashboard from './Dashboard';

// Coordinators open events from the work queue, so SG2-66's panel and recheck
// banner are wired here. Both have their own suites; these stubs show what the
// pane hands them and let a test report an acceptance or a settled recheck.
vi.mock('../components/ChangeRequestsPanel', () => ({
  default: ({ eventId, accessToken, onAccepted }: { eventId: number; accessToken: string; onAccepted: () => void }) => (
    <section data-testid="change-requests-panel">
      Change requests for event {eventId} with {accessToken}
      <button type="button" onClick={onAccepted}>Stub accept</button>
    </section>
  ),
}));
vi.mock('../components/ArrangementRechecks', () => ({
  default: ({ eventId, onSettled }: { eventId: number; onSettled: () => void }) => (
    <section data-testid="arrangement-rechecks-stub">
      Rechecks for event {eventId}
      <button type="button" onClick={onSettled}>Stub settle</button>
    </section>
  ),
}));
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/EventArrangements', () => ({ default: () => null }));
vi.mock('../venues/BookingClashes', () => ({ BookingClashes: () => null }));
// SG2-92: its own suites cover it; stubbed so its fetch stays out of this one.
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const showcase: WorkItem = {
  kind: 'event', item_id: 661, event_id: 661, title: 'Harbour Showcase', event_name: 'Harbour Showcase',
  status: 'confirmed', starts_at: '2030-06-15T02:00:00Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { organisation: 'Harbour Trust', expected_attendance: 120, registration_needed: true },
};

/** Serves the queue, then each re-read of the selected item from `items` in turn. */
function serveQueue(...items: WorkItem[]) {
  const reads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    reads.push(url);
    const selected = url.endsWith('/event/661');
    const index = Math.min(reads.filter((read) => read.endsWith('/event/661')).length - 1, items.length - 1);
    return Response.json({ items: [selected ? items[index] : items[0]] });
  }));
  return reads;
}

async function openShowcase() {
  render(<Dashboard role="Event Coordinator" accessToken="coordinator-token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Harbour Showcase/ }));
  return screen.findByRole('article', { name: 'Event request' });
}

describe('work queue change impact (SG2-66)', () => {
  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC4] the assigned coordinator sees change requests on the event and an acceptance re-reads it', async () => {
    const reads = serveQueue(showcase, { ...showcase, status: 'planning' });
    const pane = await openShowcase();
    expect(within(pane).getByTestId('change-requests-panel')).toHaveTextContent('Change requests for event 661 with coordinator-token');
    expect(within(pane).getByTestId('arrangement-rechecks-stub')).toHaveTextContent('Rechecks for event 661');
    expect(within(pane).getByText('confirmed')).toBeInTheDocument();

    fireEvent.click(within(pane).getByRole('button', { name: 'Stub accept' }));
    const reloaded = await screen.findByRole('article', { name: 'Event request' });
    expect(await within(reloaded).findByText('planning')).toBeInTheDocument();
    expect(reads.filter((url) => url.endsWith('/event/661'))).toHaveLength(2);
  });

  test('[NORMAL] [SG2-66:AC4] a settled recheck re-reads the event', async () => {
    const reads = serveQueue({ ...showcase, status: 'planning' });
    const pane = await openShowcase();
    fireEvent.click(within(pane).getByRole('button', { name: 'Stub settle' }));
    await screen.findByRole('article', { name: 'Event request' });
    expect(reads.filter((url) => url.endsWith('/event/661'))).toHaveLength(2);
  });

  test.each([
    ['not assigned to them', { assigned_to_me: false }],
    ['still under review', { status: 'under_review' }],
    ['completed', { status: 'completed' }],
  ])('[BOUNDARY] [SG2-66:AC1] an event %s shows no change requests or rechecks', async (_label, override) => {
    serveQueue({ ...showcase, ...override });
    const pane = await openShowcase();
    expect(within(pane).queryByTestId('change-requests-panel')).not.toBeInTheDocument();
    expect(within(pane).queryByTestId('arrangement-rechecks-stub')).not.toBeInTheDocument();
  });
});
