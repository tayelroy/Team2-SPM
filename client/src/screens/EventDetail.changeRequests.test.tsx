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

describe('EventDetail change requests for the organiser (SG2-64)', () => {
  test('[NORMAL] [BOUNDARY] [SG2-64:AC1] [SG2-64:AC4] the creating organiser can ask for a change on every submitted, open event and nobody else sees the form', async () => {
    for (const status of ['submitted', 'under_review', 'needs_clarification', 'approved', 'planning', 'preparation', 'confirmed']) {
      cleanup(); vi.restoreAllMocks();
      renderAs('Event Organiser', { ...detail, status });
      expect(await screen.findByTestId('organiser-change-requests')).toHaveTextContent('64 token-64');
    }
    for (const [label, role, override] of [
      ['a draft', 'Event Organiser', { status: 'draft', waitingOnMe: true }],
      ['a cancelled event', 'Event Organiser', { status: 'cancelled' }],
      ['a rejected event', 'Event Organiser', { status: 'rejected' }],
      ['a completed event', 'Event Organiser', { status: 'completed' }],
      ['an organisation colleague who did not create it', 'Event Organiser', { canManage: false }],
      ['the assigned coordinator', 'Event Coordinator', { canManage: false }],
    ] as const) {
      cleanup(); vi.restoreAllMocks();
      renderAs(role, { ...detail, ...override });
      expect(await screen.findByRole('heading', { name: 'Change Forum' }), label).toBeInTheDocument();
      expect(screen.queryByTestId('organiser-change-requests'), label).not.toBeInTheDocument();
    }
  });

  test('[NORMAL] [CONFLICT] [FAILURE] [SG2-64:AC5] while returned for clarification there is no Edit request, only Resubmit for review, which reloads the event or says why it was refused; a draft keeps Edit', async () => {
    const fetchDetail = renderAs('Event Organiser', RETURNED);
    const submit = vi.spyOn(eventRequestsApi, 'submitEventRequest').mockResolvedValue({ ok: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Resubmit for review' }));
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.getByText('Answer your coordinator, then resubmit the request for review.')).toBeVisible();
    await vi.waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenCalledWith(64, 'token-64');

    cleanup(); vi.restoreAllMocks();
    renderAs('Event Organiser', { ...detail, status: 'draft', waitingOnMe: true });
    expect(await screen.findByRole('button', { name: 'Edit request' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resubmit for review' })).not.toBeInTheDocument();
    expect(screen.getByText('You can edit and submit this request while it is a draft.')).toBeVisible();

    for (const [result, message] of [
      [{ ok: false, kind: 'error', message: 'Only a draft or rejected event request can be submitted.' } as const,
        'Only a draft or rejected event request can be submitted.'],
      [{ ok: false, kind: 'unavailable' } as const, 'Could not resubmit the request. Please try again.'],
    ] as const) {
      cleanup(); vi.restoreAllMocks();
      renderAs('Event Organiser', RETURNED);
      vi.spyOn(eventRequestsApi, 'submitEventRequest').mockResolvedValue(result);
      fireEvent.click(await screen.findByRole('button', { name: 'Resubmit for review' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeEnabled();
    }
  });
});
