import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

// The panel's own reading and settings are covered in RegistrationPanel.test.tsx;
// this stub shows which event and token EventDetail hands it.
vi.mock('../components/RegistrationPanel', () => ({
  default: ({ eventId, accessToken }: { eventId: number; accessToken: string }) => (
    <section data-testid="registration-panel">Registration for event {eventId} with {accessToken}</section>
  ),
}));
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));

vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const detail: eventRequestsApi.EventRequestDetail = {
  eventId: 63, organiserId: 'org-1', organisation: 'Acme Corp', status: 'confirmed', name: 'Registration Forum',
  purpose: 'Sharing', description: '', proposedDate: '2026-11-20T02:00:00.000Z', expectedAttendance: 120,
  venueRequirements: null, accessibilityNeeds: null, equipmentRequirements: null, registrationNeeded: true,
  coordinatorId: 'coord-1', coordinatorName: 'Sarah Jenkins', canManage: true, waitingOnMe: false,
  decisionReason: null, decidedAt: null, completedBy: null, completedAt: null, endsAt: null,
};
const stage: eventRequestsApi.EventStageResult = {
  event_id: 63, raw_status: 'confirmed', stage: 'Confirmed', stage_key: 'confirmed',
  description: 'Confirmed.', waiting_on: null, stepper_steps: [], arrangements_recheck_needed: false, outstanding_arrangements: [],
};

function renderAs(role: 'Event Organiser', request: eventRequestsApi.EventRequestDetail) {
  vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request });
  vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
  render(<EventDetail role={role} selectedEventId={63} accessToken="token-63" onNavigate={vi.fn()} />);
}

describe('EventDetail registration picture (SG2-63)', () => {
  test.each([
    ['the creating organiser', 'Event Organiser' as const, {}],
    ['an organisation colleague', 'Event Organiser' as const, { canManage: false }],
  ])('[NORMAL] [SG2-63:AC1] [SG2-63:AC3] %s sees the registration picture of an event taking registrations', async (_label, role, override) => {
    renderAs(role, { ...detail, ...override });
    expect(await screen.findByTestId('registration-panel')).toHaveTextContent('Registration for event 63 with token-63');
  });

  test.each([
    ['an event that takes no registrations', 'Event Organiser' as const, { registrationNeeded: false }],
    ['a draft still being written', 'Event Organiser' as const, { status: 'draft' }],
  ])('[BOUNDARY] [SG2-63:AC3] %s shows no registration picture', async (_label, role, override) => {
    renderAs(role, { ...detail, ...override });
    expect(await screen.findByRole('heading', { name: 'Registration Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('registration-panel')).not.toBeInTheDocument();
  });
});
