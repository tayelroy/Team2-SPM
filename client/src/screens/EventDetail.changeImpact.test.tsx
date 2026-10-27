import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));
// SG2-92: its own suites cover it; stubbed so its fetch stays out of this one.
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const detail: eventRequestsApi.EventRequestDetail = {
  eventId: 66,
  organiserId: 'org-1',
  organisation: 'Acme Corp',
  status: 'confirmed',
  name: 'Impact Forum',
  purpose: 'Change impact',
  description: '',
  proposedDate: '2026-11-20T02:00:00.000Z',
  expectedAttendance: 120,
  venueRequirements: null,
  accessibilityNeeds: null,
  equipmentRequirements: null,
  registrationNeeded: true,
  coordinatorId: 'coord-1',
  coordinatorName: 'Sarah Jenkins',
  canManage: false,
  waitingOnMe: false,
  decisionReason: null,
  decidedAt: null,
  completedBy: null,
  completedAt: null,
  endsAt: null,
};

const stage: eventRequestsApi.EventStageResult = {
  event_id: 66,
  raw_status: 'planning',
  stage: 'Planning',
  stage_key: 'planning',
  description: 'Arrangements are being rechecked.',
  waiting_on: null,
  stepper_steps: [],
  arrangements_recheck_needed: true,
  // `venue` is legacy SG2-39 vocabulary: shown as a tag, but nothing to settle.
  outstanding_arrangements: ['venue_recheck', 'venue', 'equipment_recheck', 'registration_recheck'],
};

function renderAs(role: 'Event Organiser') {
  render(
    <EventDetail role={role} selectedEventId={66} accessToken="token-66" onNavigate={vi.fn()} />,
  );
}

describe('EventDetail change impact (SG2-66)', () => {

  test('[BOUNDARY] [SG2-66:AC1] [SG2-66:AC4] the organiser sees the recheck banner but neither the panel nor the settle buttons', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, canManage: true } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs('Event Organiser');

    const banner = await screen.findByTestId('arrangements-recheck-banner');
    expect(within(banner).getByTestId('outstanding-arrangements-tags')).toBeInTheDocument();
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-requests-panel')).not.toBeInTheDocument();
  });

});
