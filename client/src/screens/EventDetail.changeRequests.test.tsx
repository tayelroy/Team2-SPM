import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import type { OrganiserChangeRequestsProps } from '../components/OrganiserChangeRequests';
import EventDetail from './EventDetail';

// The panel's own steps are covered in OrganiserChangeRequests.test.tsx; this
// stub shows what EventDetail hands it.
vi.mock('../components/OrganiserChangeRequests', () => ({
  default: ({ eventId, accessToken }: OrganiserChangeRequestsProps) => (
    <section data-testid="organiser-change-requests">{`${eventId} ${accessToken}`}</section>
  ),
}));
vi.mock('../components/ClarificationThread', () => ({ default: () => null }));
vi.mock('../components/CancellationPanel', () => ({ default: () => null }));
vi.mock('../components/RegistrationPanel', () => ({ default: () => null }));
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));
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
  eventId: 64, organiserId: 'org-1', organisation: 'Acme Corp', status: 'planning', name: 'Change Forum',
  purpose: 'Sharing', description: '', proposedDate: '2026-11-20T02:00:00.000Z', expectedAttendance: 120,
  venueRequirements: null, accessibilityNeeds: null, equipmentRequirements: null, registrationNeeded: false,
  coordinatorId: 'coord-1', coordinatorName: 'Sarah Jenkins', canManage: true, waitingOnMe: false,
  decisionReason: null, decidedAt: null, completedBy: null, completedAt: null, endsAt: null,
};
const stage: eventRequestsApi.EventStageResult = {
  event_id: 64, raw_status: 'planning', stage: 'Planning', stage_key: 'planning',
  description: 'Planning.', waiting_on: null, stepper_steps: [], arrangements_recheck_needed: false, outstanding_arrangements: [],
};

function renderAs(role: 'Event Coordinator' | 'Event Organiser', request: eventRequestsApi.EventRequestDetail) {
  const fetchDetail = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request });
  vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
  render(<EventDetail role={role} selectedEventId={64} accessToken="token-64" currentUserId="coord-1" onNavigate={vi.fn()} />);
  return fetchDetail;
}

const RETURNED = { ...detail, status: 'needs_clarification', waitingOnMe: true };

describe('EventDetail change requests for the organiser (SG2-64 AC1/AC4)', () => {
  test.each(['submitted', 'under_review', 'needs_clarification', 'approved', 'planning', 'preparation', 'confirmed'])(
    '[NORMAL] [SG2-64:AC1] the creating organiser can ask for a change while the event is %s', async (status) => {
      renderAs('Event Organiser', { ...detail, status });
      expect(await screen.findByTestId('organiser-change-requests')).toHaveTextContent('64 token-64');
    });

  test.each([
    ['a draft', 'Event Organiser' as const, { status: 'draft', waitingOnMe: true }],
    ['a cancelled event', 'Event Organiser' as const, { status: 'cancelled' }],
    ['a rejected event', 'Event Organiser' as const, { status: 'rejected' }],
    ['a completed event', 'Event Organiser' as const, { status: 'completed' }],
    ['an organisation colleague who did not create it', 'Event Organiser' as const, { canManage: false }],
    ['the assigned coordinator', 'Event Coordinator' as const, { canManage: false }],
  ])('[BOUNDARY] [SG2-64:AC4] %s shows no change request form', async (_label, role, override) => {
    renderAs(role, { ...detail, ...override });
    expect(await screen.findByRole('heading', { name: 'Change Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('organiser-change-requests')).not.toBeInTheDocument();
  });
});

describe('EventDetail while returned for clarification (SG2-64 AC5)', () => {
  test('[CONFLICT] [SG2-64:AC5] there is no Edit request, only Resubmit for review, which reloads the event', async () => {
    const fetchDetail = renderAs('Event Organiser', RETURNED);
    const submit = vi.spyOn(eventRequestsApi, 'submitEventRequest').mockResolvedValue({ ok: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Resubmit for review' }));
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.getByText('Answer your coordinator, then resubmit the request for review.')).toBeVisible();
    await vi.waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenCalledWith(64, 'token-64');
  });

  test('[NORMAL] [SG2-64:AC5] a draft keeps its Edit request and offers no resubmit', async () => {
    renderAs('Event Organiser', { ...detail, status: 'draft', waitingOnMe: true });
    expect(await screen.findByRole('button', { name: 'Edit request' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resubmit for review' })).not.toBeInTheDocument();
    expect(screen.getByText('You can edit and submit this request while it is a draft.')).toBeVisible();
  });

  test.each([
    [{ ok: false, kind: 'error', message: 'Only a draft or rejected event request can be submitted.' } as const,
      'Only a draft or rejected event request can be submitted.'],
    [{ ok: false, kind: 'unavailable' } as const, 'Could not resubmit the request. Please try again.'],
  ])('[FAILURE] [SG2-64:AC5] a refused resubmission says why (%#)', async (result, message) => {
    renderAs('Event Organiser', RETURNED);
    vi.spyOn(eventRequestsApi, 'submitEventRequest').mockResolvedValue(result);
    fireEvent.click(await screen.findByRole('button', { name: 'Resubmit for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeEnabled();
  });
});
