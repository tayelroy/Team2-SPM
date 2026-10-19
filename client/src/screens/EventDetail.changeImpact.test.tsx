import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as changeRequestsApi from '../api/changeRequests';
import type { AcceptedChange, SettleRecheckResult } from '../api/changeRequests';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

// The panel's own fetching and rendering are covered in ChangeRequestsPanel.test.tsx;
// this stub shows what EventDetail hands it and lets a test report an acceptance.
vi.mock('../components/ChangeRequestsPanel', () => ({
  default: ({ eventId, accessToken, onAccepted }: {
    eventId: number; accessToken: string; onAccepted: (change: AcceptedChange) => void;
  }) => (
    <section data-testid="change-requests-panel">
      Change requests for event {eventId} with {accessToken}
      <button
        type="button"
        onClick={() => onAccepted({
          event_id: eventId, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
          arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck'],
        })}
      >
        Stub accept
      </button>
    </section>
  ),
}));
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/ConfirmedArrangements', () => ({ default: () => null }));
// SG2-92: its own suites cover it; stubbed so its fetch stays out of this one.
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));

// jsdom has no scrollIntoView; the planning drawer uses it (SG2-39).
Element.prototype.scrollIntoView = vi.fn();

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

const settledStage = { ...stage, arrangements_recheck_needed: false, outstanding_arrangements: [] };

function renderAs(role: 'Event Coordinator' | 'Event Organiser') {
  render(
    <EventDetail role={role} selectedEventId={66} accessToken="token-66" currentUserId="coord-1" onNavigate={vi.fn()} />,
  );
}

describe('EventDetail change impact (SG2-66)', () => {
  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC4] the assigned coordinator gets the change requests panel, and an acceptance reloads the event and stage', async () => {
    const loadDetail = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail')
      .mockResolvedValueOnce({ ok: true, request: detail })
      .mockResolvedValueOnce({ ok: true, request: { ...detail, status: 'planning' } });
    const loadStage = vi.spyOn(eventRequestsApi, 'getEventStage')
      .mockResolvedValueOnce({ ok: true, stage: settledStage })
      .mockResolvedValueOnce({ ok: true, stage });
    renderAs('Event Coordinator');

    expect(await screen.findByTestId('change-requests-panel')).toHaveTextContent('Change requests for event 66 with token-66');
    expect(screen.queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stub accept' }));
    expect(await screen.findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(loadStage).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('Planning').length).toBeGreaterThan(0);
  });

  test('[BOUNDARY] [SG2-66:AC1] [SG2-66:AC4] the organiser sees the recheck banner but neither the panel nor the settle buttons', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, canManage: true } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    renderAs('Event Organiser');

    const banner = await screen.findByTestId('arrangements-recheck-banner');
    expect(within(banner).getByTestId('outstanding-arrangements-tags')).toBeInTheDocument();
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-requests-panel')).not.toBeInTheDocument();
  });

  test.each([
    ['a completed event', { status: 'completed' }],
    ['an event assigned to another coordinator', { coordinatorId: 'coord-2' }],
  ])('[BOUNDARY] [SG2-66:AC1] a coordinator viewing %s gets no change requests panel', async (_label, override) => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, ...override } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage: settledStage });
    renderAs('Event Coordinator');
    expect(await screen.findByRole('heading', { name: 'Impact Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('change-requests-panel')).not.toBeInTheDocument();
  });

  test('[NORMAL] [SG2-66:AC4] the coordinator settles a recheck from the banner and the stage is re-read', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, status: 'planning' } });
    const loadStage = vi.spyOn(eventRequestsApi, 'getEventStage')
      .mockResolvedValueOnce({ ok: true, stage })
      .mockResolvedValueOnce({ ok: true, stage: settledStage });
    let finish: (value: SettleRecheckResult) => void = () => {};
    const settle = vi.spyOn(changeRequestsApi, 'settleRecheck').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderAs('Event Coordinator');

    const banner = await screen.findByTestId('arrangements-recheck-banner');
    expect(within(banner).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Mark venue rechecked',
      'Mark equipment rechecked',
      'Mark registrations rechecked',
    ]);
    fireEvent.click(within(banner).getByRole('button', { name: 'Mark venue rechecked' }));
    expect(settle).toHaveBeenCalledWith(66, 'venue_recheck', 'token-66');
    // One settle at a time.
    for (const button of within(banner).getAllByRole('button')) expect(button).toBeDisabled();

    await act(async () => finish({
      ok: true,
      settled: { event_id: 66, arrangements_recheck_needed: false, outstanding_arrangements: [] },
    }));
    expect(await screen.findByRole('heading', { name: 'Impact Forum' })).toBeInTheDocument();
    expect(screen.queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument();
    expect(loadStage).toHaveBeenCalledTimes(2);
  });

  test('[CONFLICT] [SG2-66:AC4] a recheck that still fails its checks lists the blockers and stays outstanding', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, status: 'planning' } });
    const loadStage = vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    vi.spyOn(changeRequestsApi, 'settleRecheck').mockResolvedValue({
      ok: false,
      kind: 'blocked',
      message: 'This arrangement still needs attention before it can be marked rechecked.',
      blockers: [
        'The Kelp Room does not cover the event start.',
        'The Kelp Room holds 150, below the expected attendance of 180.',
      ],
    });
    renderAs('Event Coordinator');

    fireEvent.click(await screen.findByRole('button', { name: 'Mark venue rechecked' }));
    const blockers = await screen.findByTestId('recheck-blockers');
    expect(blockers).toHaveAttribute('role', 'alert');
    expect(blockers).toHaveTextContent('This arrangement still needs attention before it can be marked rechecked.');
    expect(within(blockers).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The Kelp Room does not cover the event start.',
      'The Kelp Room holds 150, below the expected attendance of 180.',
    ]);
    expect(screen.getByRole('button', { name: 'Mark venue rechecked' })).toBeEnabled();
    expect(loadStage).toHaveBeenCalledTimes(1);
  });

  test('[FAILURE] [SG2-66:AC4] any other refusal is shown without a blocker list, and an accepted change clears it', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: { ...detail, status: 'planning' } });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    vi.spyOn(changeRequestsApi, 'settleRecheck').mockResolvedValue({
      ok: false, kind: 'conflict', message: 'That arrangement is not waiting for a recheck.',
    });
    renderAs('Event Coordinator');

    fireEvent.click(await screen.findByRole('button', { name: 'Mark registrations rechecked' }));
    const failure = await screen.findByTestId('recheck-error');
    expect(failure).toHaveTextContent('That arrangement is not waiting for a recheck.');
    expect(within(failure).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recheck-blockers')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stub accept' }));
    expect(await screen.findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('recheck-error')).not.toBeInTheDocument();
  });
});
