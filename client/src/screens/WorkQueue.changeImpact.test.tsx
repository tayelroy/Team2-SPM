import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import * as eventRequestsApi from '../api/eventRequests';
import * as changeRequestsApi from '../api/changeRequests';
import Dashboard from './Dashboard';

// Coordinators open events from the work queue, so SG2-66's panel and recheck
// banner are wired here. The change-request stub reports an acceptance; the
// real recheck banner exercises refusal state and its reset on the parent reload.
vi.mock('../components/ChangeRequestsPanel', () => ({
  default: ({ eventId, accessToken, onAccepted }: { eventId: number; accessToken: string; onAccepted: () => void }) => (
    <section data-testid="change-requests-panel">
      Change requests for event {eventId} with {accessToken}
      <button type="button" onClick={onAccepted}>Stub accept</button>
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
  vi.restoreAllMocks();
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
  vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage: {
    event_id: 661, raw_status: 'planning', stage: 'Planning', stage_key: 'planning',
    description: 'Arrangements are being rechecked.', waiting_on: null, stepper_steps: [],
    arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck'],
  } });
  vi.spyOn(changeRequestsApi, 'settleRecheck').mockResolvedValue({ ok: true, settled: {
    event_id: 661, arrangements_recheck_needed: false, outstanding_arrangements: [],
  } });
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
  test('[NORMAL] [FAILURE] [SG2-66:AC1] [SG2-66:AC4] the assigned coordinator sees change requests on the event and an acceptance re-reads it', async () => {
    const reads = serveQueue(showcase, { ...showcase, status: 'planning' });
    vi.mocked(changeRequestsApi.settleRecheck).mockResolvedValue({
      ok: false, kind: 'conflict', message: 'That arrangement is not waiting for a recheck.',
    });
    const pane = await openShowcase();
    expect(within(pane).getByTestId('change-requests-panel')).toHaveTextContent('Change requests for event 661 with coordinator-token');
    expect(await within(pane).findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    expect(within(pane).getByText('confirmed')).toBeInTheDocument();

    fireEvent.click(within(pane).getByRole('button', { name: 'Mark venue rechecked' }));
    const failure = await within(pane).findByTestId('recheck-error');
    expect(failure).toHaveTextContent('That arrangement is not waiting for a recheck.');
    expect(within(failure).queryByRole('list')).not.toBeInTheDocument();
    expect(within(pane).queryByTestId('recheck-blockers')).not.toBeInTheDocument();

    fireEvent.click(within(pane).getByRole('button', { name: 'Stub accept' }));
    const reloaded = await screen.findByRole('article', { name: 'Event request' });
    expect(await within(reloaded).findByText('planning')).toBeInTheDocument();
    expect(await within(reloaded).findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    expect(within(reloaded).queryByTestId('recheck-error')).not.toBeInTheDocument();
    expect(reads.filter((url) => url.endsWith('/event/661'))).toHaveLength(2);
  });

  test('[NORMAL] [SG2-66:AC4] a settled recheck re-reads the event', async () => {
    const reads = serveQueue({ ...showcase, status: 'planning' });
    vi.mocked(eventRequestsApi.getEventStage)
      .mockResolvedValueOnce({ ok: true, stage: {
        event_id: 661, raw_status: 'planning', stage: 'Planning', stage_key: 'planning',
        description: 'Arrangements are being rechecked.', waiting_on: null, stepper_steps: [],
        arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck'],
      } })
      .mockResolvedValue({ ok: true, stage: {
        event_id: 661, raw_status: 'planning', stage: 'Planning', stage_key: 'planning',
        description: 'Arrangements have been rechecked.', waiting_on: null, stepper_steps: [],
        arrangements_recheck_needed: false, outstanding_arrangements: [],
      } });
    const pane = await openShowcase();
    fireEvent.click(await within(pane).findByRole('button', { name: 'Mark venue rechecked' }));
    await screen.findByRole('article', { name: 'Event request' });
    expect(reads.filter((url) => url.endsWith('/event/661'))).toHaveLength(2);
    expect(changeRequestsApi.settleRecheck).toHaveBeenCalledWith(661, 'venue_recheck', 'coordinator-token');
    await vi.waitFor(() => expect(screen.queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument());
  });

  test.each([
    ['not assigned to them', { assigned_to_me: false }],
    ['completed', { status: 'completed' }],
  ])('[BOUNDARY] [SG2-66:AC1] an event %s shows no change requests or rechecks', async (_label, override) => {
    serveQueue({ ...showcase, ...override });
    const pane = await openShowcase();
    expect(within(pane).queryByTestId('change-requests-panel')).not.toBeInTheDocument();
    expect(within(pane).queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument();
  });

  test.each(['under_review', 'needs_clarification'])(
    '[BOUNDARY] [SG2-64:AC2] [SG2-64:AC3] an event %s shows the organiser’s change requests but no rechecks', async (status) => {
      serveQueue({ ...showcase, status });
      const pane = await openShowcase();
      expect(within(pane).getByTestId('change-requests-panel')).toBeInTheDocument();
      expect(within(pane).queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument();
    });
});
