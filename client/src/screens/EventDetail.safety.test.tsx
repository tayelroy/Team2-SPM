import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

// The summary's own fetching and rework are covered in SafetyDecisionSummary.test.tsx;
// this stub shows the organiser's read-only event and role capability.
vi.mock('../components/SafetyDecisionSummary', () => ({
  default: ({ eventId, accessToken, status, canRework }: {
    eventId: number; accessToken: string; status: string; canRework: boolean;
  }) => (
    <section data-testid="safety-decision-summary">
      Safety for event {eventId} with {accessToken}, {status}, {canRework ? 'can rework' : 'read only'}
    </section>
  ),
}));

vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));

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

function renderAs(role: 'Event Organiser') {
  render(<EventDetail role={role} selectedEventId={92} accessToken="token-92" onNavigate={vi.fn()} />);
}

describe('EventDetail safety decision (SG2-92)', () => {

  test('[NORMAL] [SG2-92:AC5] [SG2-92:AC6] the creating organiser sees the decision but cannot rework', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, canManage: true } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs('Event Organiser');
    expect(await screen.findByTestId('safety-decision-summary')).toHaveTextContent('read only');
  });

  test.each([
    ['an organisation colleague who did not create it', 'Event Organiser' as const, {}],
  ])('[BOUNDARY] [SG2-92:AC6] %s shows no safety decision', async (_label, role, override) => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, ...override } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs(role);
    expect(await screen.findByRole('heading', { name: 'Safety Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('safety-decision-summary')).not.toBeInTheDocument();
  });
});
