import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import type { CancellationPanelProps } from '../components/CancellationPanel';
import EventDetail from './EventDetail';

// The panel's own steps are covered in CancellationPanel.test.tsx; this stub
// shows what EventDetail hands it and lets a test report a change.
vi.mock('../components/CancellationPanel', () => ({
  default: ({ eventId, mode, status, requestedAt, reason, cancelledAt, onChanged }: CancellationPanelProps) => (
    <section data-testid="cancellation-panel">
      {`${eventId} ${mode} ${status} ${requestedAt} ${reason} ${cancelledAt}`}
      <button type="button" onClick={onChanged}>Report change</button>
    </section>
  ),
}));
vi.mock('../components/RegistrationPanel', () => ({ default: () => null }));
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));

vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const detail: eventRequestsApi.EventRequestDetail = {
  eventId: 67, organiserId: 'org-1', organisation: 'Acme Corp', status: 'planning', name: 'Cancel Forum',
  purpose: 'Sharing', description: '', proposedDate: '2026-11-20T02:00:00.000Z', expectedAttendance: 120,
  venueRequirements: null, accessibilityNeeds: null, equipmentRequirements: null, registrationNeeded: false,
  coordinatorId: 'coord-1', coordinatorName: 'Sarah Jenkins', canManage: true, waitingOnMe: false,
  decisionReason: null, decidedAt: null, completedBy: null, completedAt: null, endsAt: null,
};
const stage: eventRequestsApi.EventStageResult = {
  event_id: 67, raw_status: 'planning', stage: 'Planning', stage_key: 'planning',
  description: 'Planning.', waiting_on: null, stepper_steps: [], arrangements_recheck_needed: false, outstanding_arrangements: [],
};

function renderAs(role: 'Event Organiser', request: eventRequestsApi.EventRequestDetail) {
  const fetchDetail = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request });
  vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
  render(<EventDetail role={role} selectedEventId={67} accessToken="token-67" onNavigate={vi.fn()} />);
  return fetchDetail;
}

describe('EventDetail cancellation panel (SG2-67)', () => {
  test('[NORMAL] [SG2-67:AC1] [SG2-67:AC4] the creating organiser gets the panel in organiser mode, and a request reloads the event', async () => {
    const fetchDetail = renderAs('Event Organiser', detail);
    expect(await screen.findByTestId('cancellation-panel')).toHaveTextContent('67 organiser planning null null null');
    fireEvent.click(screen.getByRole('button', { name: 'Report change' }));
    await vi.waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
    cleanup();
    renderAs('Event Organiser', {
      ...detail, status: 'cancelled', cancellationRequestedAt: '2026-10-21T01:00:00Z',
      cancellationReason: 'Speaker withdrew', cancelledAt: '2026-10-21T02:00:00Z',
    });
    expect(await screen.findByTestId('cancellation-panel')).toHaveTextContent(
      '67 organiser cancelled 2026-10-21T01:00:00Z Speaker withdrew 2026-10-21T02:00:00Z');
  });

  test.each([
    ['a draft, which is deleted instead', 'Event Organiser' as const, { status: 'draft' }],
    ['a completed event', 'Event Organiser' as const, { status: 'completed' }],
    ['a rejected event with an old cancellation request', 'Event Organiser' as const,
      { status: 'REJECTED', cancellationRequestedAt: '2026-10-21T01:00:00Z', cancellationReason: 'Speaker withdrew' }],
    ['an organisation colleague who did not create it', 'Event Organiser' as const, { canManage: false }],
  ])('[BOUNDARY] [SG2-67:AC1] %s shows no cancellation panel', async (_label, role, override) => {
    renderAs(role, { ...detail, ...override });
    expect(await screen.findByRole('heading', { name: 'Cancel Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('cancellation-panel')).not.toBeInTheDocument();
  });
});
