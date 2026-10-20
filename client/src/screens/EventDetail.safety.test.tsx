import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

// The summary's own fetching and rework are covered in SafetyDecisionSummary.test.tsx;
// this stub shows what EventDetail hands it and lets a test report a rework.
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
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));

// jsdom has no scrollIntoView; the planning drawer uses it (SG2-39).
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const detail: eventRequestsApi.EventRequestDetail = {
  eventId: 92, organiserId: 'org-1', organisation: 'Acme Corp', status: 'safety_rejected', name: 'Safety Forum',
  purpose: 'Safety check', description: '', proposedDate: '2026-11-20T02:00:00.000Z', expectedAttendance: 120,
  venueRequirements: null, accessibilityNeeds: null, equipmentRequirements: null, registrationNeeded: false,
  coordinatorId: 'coord-1', coordinatorName: 'Sarah Jenkins', canManage: false, waitingOnMe: false,
  decisionReason: null, decidedAt: null, completedBy: null, completedAt: null, endsAt: null,
};
const stage: eventRequestsApi.EventStageResult = {
  event_id: 92, raw_status: 'safety_rejected', stage: 'Safety Rejected', stage_key: 'safety_rejected',
  description: 'The operational safety check was not passed.', waiting_on: null, stepper_steps: [],
  arrangements_recheck_needed: false, outstanding_arrangements: [],
};

function renderAs(role: 'Event Coordinator' | 'Event Organiser') {
  render(<EventDetail role={role} selectedEventId={92} accessToken="token-92" currentUserId="coord-1" onNavigate={vi.fn()} />);
}

describe('EventDetail safety decision (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC4] the assigned coordinator of a Safety Rejected event can rework it, which reloads the event', async () => {
    const load = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail')
      .mockResolvedValueOnce({ ok: true, request: detail })
      .mockResolvedValueOnce({ ok: true, request: { ...detail, status: 'planning' } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs('Event Coordinator');
    expect(await screen.findByTestId('safety-decision-summary')).toHaveTextContent('Safety for event 92 with token-92, safety_rejected, can rework');
    fireEvent.click(screen.getByRole('button', { name: 'Stub rework' }));
    expect(await screen.findByText(/Safety for event 92 with token-92, planning, can rework/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('[NORMAL] [SG2-92:AC5] [SG2-92:AC6] the creating organiser sees the decision but cannot rework', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, canManage: true } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs('Event Organiser');
    expect(await screen.findByTestId('safety-decision-summary')).toHaveTextContent('read only');
  });

  test.each([
    ['an organisation colleague who did not create it', 'Event Organiser' as const, {}],
    ['a coordinator not assigned to it', 'Event Coordinator' as const, { coordinatorId: 'coord-2' }],
    ['an event still under review', 'Event Coordinator' as const, { status: 'under_review' }],
  ])('[BOUNDARY] [SG2-92:AC6] %s shows no safety decision', async (_label, role, override) => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, ...override } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs(role);
    expect(await screen.findByRole('heading', { name: 'Safety Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('safety-decision-summary')).not.toBeInTheDocument();
  });
});
