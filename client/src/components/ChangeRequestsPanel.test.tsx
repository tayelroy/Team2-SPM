import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as changeRequestsApi from '../api/changeRequests';
import type { AcceptChangeRequestResult, ChangeRequest, ChangeRequestList } from '../api/changeRequests';
import ChangeRequestsPanel from './ChangeRequestsPanel';
import { formatSgtTimestamp } from './EventAuditDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const attendance: ChangeRequest = {
  id: 'mock-12-attendance',
  requested_at: '2026-10-19T02:00:00.000Z',
  reason: 'More guests have confirmed than planned.',
  status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }],
  significant: true,
  impact: {
    requires_revalidation: true,
    outstanding_arrangements: ['venue_recheck', 'equipment_recheck', 'registration_recheck'],
    arrangements: [
      {
        kind: 'venue_booking', id: 5, label: 'The Kelp Room',
        starts_at: '2026-11-20T02:00:00.000Z', ends_at: '2026-11-20T06:00:00.000Z',
        reasons: [
          { code: 'revalidate', message: 'The Kelp Room must be revalidated for the changed event.' },
          { code: 'capacity_check', message: 'Attendance 180 exceeds The Kelp Room capacity 150; only Venue Staff can approve a capacity exception for the revised attendance.' },
        ],
      },
      {
        kind: 'equipment_request', id: 9, label: '12 × Wireless microphones', starts_at: null, ends_at: null,
        reasons: [{ code: 'revalidate', message: 'Wireless microphones must be revalidated.' }],
      },
      {
        kind: 'registrations', label: '40 registrations',
        reasons: [{ code: 'revalidate', message: 'Registrations must be revalidated.' }],
      },
    ],
  },
};

const dateChange: ChangeRequest = {
  id: 'mock-12-date',
  requested_at: '2026-10-19T02:00:00.000Z',
  reason: 'The keynote speaker can only attend a week later.',
  status: 'pending',
  changes: [{ field: 'proposed_date', label: 'Proposed date', from: '2026-11-20T02:00:00.000Z', to: '2026-11-27T02:00:00.000Z' }],
  significant: true,
  impact: {
    requires_revalidation: true,
    outstanding_arrangements: ['venue_recheck'],
    arrangements: [{
      kind: 'venue_request', id: 3, label: 'Harbour Hall',
      starts_at: '2026-11-20T02:00:00.000Z', ends_at: '2026-11-20T06:00:00.000Z',
      reasons: [{ code: 'period_recheck', message: 'Harbour Hall is held for 20 Nov; the event now starts 27 Nov.' }],
    }],
  },
};

const description: ChangeRequest = {
  id: 'mock-12-description',
  requested_at: '2026-10-19T02:00:00.000Z',
  reason: 'Agenda wording update.',
  status: 'pending',
  changes: [{ field: 'description', label: 'Description', from: null, to: '(updated agenda)' }],
  significant: false,
  impact: { requires_revalidation: false, outstanding_arrangements: [], arrangements: [] },
};

const noArrangements: ChangeRequest = {
  ...attendance,
  id: 'mock-13-attendance',
  impact: { requires_revalidation: true, outstanding_arrangements: [], arrangements: [] },
};

function listOf(requests: ChangeRequest[], canAccept = true): ChangeRequestList {
  return { event: { event_id: 12, status: 'confirmed' }, can_accept: canAccept, change_requests: requests };
}

function mockList(list: ChangeRequestList) {
  return vi.spyOn(changeRequestsApi, 'fetchChangeRequests').mockResolvedValue({ ok: true, list });
}

function renderPanel(onAccepted = vi.fn()) {
  render(<ChangeRequestsPanel eventId={12} accessToken="coordinator-token" onAccepted={onAccepted} />);
  return onAccepted;
}

describe('ChangeRequestsPanel', () => {
  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC2] [SG2-66:AC3] lists change requests with their changes, marker and affected arrangements', async () => {
    const fetch = mockList(listOf([attendance, dateChange, description]));
    renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent('Loading change requests…');
    const card = await screen.findByTestId('change-request-mock-12-attendance');
    expect(fetch).toHaveBeenCalledWith(12, 'coordinator-token');

    // AC1: a significant change lists every affected arrangement for revalidation.
    expect(within(card).getByText('Significant change')).toBeInTheDocument();
    expect(within(card).getByText('More guests have confirmed than planned.')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Requested changes' })).toHaveTextContent('Expected attendance: 120 → 180');
    const items = within(card).getAllByTestId('affected-arrangement');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Venue booking');
    expect(items[0]).toHaveTextContent('The Kelp Room');
    expect(items[0]).toHaveTextContent(
      `Booked for ${formatSgtTimestamp('2026-11-20T02:00:00.000Z')} – ${formatSgtTimestamp('2026-11-20T06:00:00.000Z')}`,
    );
    // AC2: the capacity check reads differently from a plain revalidation.
    const kelpReasons = within(items[0]).getByRole('list', { name: 'Why The Kelp Room needs attention' });
    expect(kelpReasons.querySelector('[data-reason="revalidate"]')).toHaveTextContent('Revalidate');
    expect(kelpReasons.querySelector('[data-reason="capacity_check"]')).toHaveTextContent(
      'Capacity checkAttendance 180 exceeds The Kelp Room capacity 150; only Venue Staff can approve a capacity exception',
    );
    expect(items[1]).toHaveTextContent('Equipment request');
    expect(items[1]).not.toHaveTextContent('Booked for');
    expect(items[2]).toHaveTextContent('Registrations40 registrations');
    expect(card).toHaveTextContent(
      'Accepting marks the venue, equipment and registrations as outstanding. The event stays in Planning until each one is rechecked.',
    );
    expect(within(card).getByRole('button', { name: 'Accept change' })).toBeEnabled();

    // AC3: a date change flags the booked period for a recheck.
    const dateCard = screen.getByTestId('change-request-mock-12-date');
    expect(within(dateCard).getByRole('list', { name: 'Requested changes' })).toHaveTextContent(
      `Proposed date: ${formatSgtTimestamp('2026-11-20T02:00:00.000Z')} → ${formatSgtTimestamp('2026-11-27T02:00:00.000Z')}`,
    );
    const [dateItem] = within(dateCard).getAllByTestId('affected-arrangement');
    expect(dateItem).toHaveTextContent('Venue request');
    // A pending request is not a booking yet.
    expect(dateItem).toHaveTextContent(
      `Requested for ${formatSgtTimestamp('2026-11-20T02:00:00.000Z')} – ${formatSgtTimestamp('2026-11-20T06:00:00.000Z')}`,
    );
    expect(dateItem.querySelector('[data-reason="period_recheck"]')).toHaveTextContent(
      'Period recheckHarbour Hall is held for 20 Nov; the event now starts 27 Nov.',
    );
    expect(dateCard).toHaveTextContent('Accepting marks the venue as outstanding.');
  });

  test('[BOUNDARY] [SG2-66:AC1] a non-significant change needs no revalidation and lists nothing', async () => {
    mockList(listOf([description]));
    renderPanel();
    const card = await screen.findByTestId('change-request-mock-12-description');
    expect(within(card).getByText('No revalidation needed')).toBeInTheDocument();
    expect(within(card).queryByText('Significant change')).not.toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Requested changes' })).toHaveTextContent('Description: (empty) → (updated agenda)');
    expect(within(card).queryAllByTestId('affected-arrangement')).toHaveLength(0);
    expect(card).toHaveTextContent('Accepting updates the event details only; no arrangements need rechecking.');
  });

  test('[BOUNDARY] [SG2-66:AC1] a significant change with nothing booked says no arrangement is affected', async () => {
    mockList(listOf([noArrangements]));
    renderPanel();
    const card = await screen.findByTestId('change-request-mock-13-attendance');
    expect(within(card).getByText('Significant change')).toBeInTheDocument();
    expect(card).toHaveTextContent('No existing arrangements are affected by this change.');
  });

  test('[BOUNDARY] [SG2-66:AC1] says so when no change request is waiting', async () => {
    mockList(listOf([]));
    renderPanel();
    expect(await screen.findByText('No change requests are waiting for your decision.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept change' })).not.toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-66:AC4] accepting is disabled when the event status does not allow a change', async () => {
    const accept = vi.spyOn(changeRequestsApi, 'acceptChangeRequest');
    vi.spyOn(changeRequestsApi, 'fetchChangeRequests').mockResolvedValue({
      ok: true,
      list: { ...listOf([attendance, description], false), event: { event_id: 12, status: 'completed' } },
    });
    renderPanel();
    await screen.findByTestId('change-request-mock-12-attendance');
    expect(screen.getByRole('status')).toHaveTextContent('Changes cannot be accepted while this event is Completed.');
    for (const button of screen.getAllByRole('button', { name: 'Accept change' })) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(accept).not.toHaveBeenCalled();
  });

  test('[NORMAL] [SG2-66:AC4] accepting shows a busy state, drops the request and asks the screen to reload', async () => {
    mockList(listOf([attendance, description]));
    let settle: (value: AcceptChangeRequestResult) => void = () => {};
    const accept = vi.spyOn(changeRequestsApi, 'acceptChangeRequest').mockReturnValue(
      new Promise((resolve) => { settle = resolve; }),
    );
    const onAccepted = renderPanel();
    const card = await screen.findByTestId('change-request-mock-12-attendance');

    fireEvent.click(within(card).getByRole('button', { name: 'Accept change' }));
    expect(accept).toHaveBeenCalledWith(12, 'mock-12-attendance', 'coordinator-token', undefined);
    expect(within(card).getByRole('button', { name: 'Accepting change…' })).toBeDisabled();
    // One acceptance at a time: the other request waits too.
    const other = screen.getByTestId('change-request-mock-12-description');
    expect(within(other).getByRole('button', { name: 'Accept change' })).toBeDisabled();

    const change = {
      event_id: 12, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
      arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck' as const],
    };
    await act(async () => settle({ ok: true, change }));
    expect(onAccepted).toHaveBeenCalledWith(change);
    expect(screen.queryByTestId('change-request-mock-12-attendance')).not.toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Accept change' })).toBeEnabled();
  });

  test('[FAILURE] [SG2-66:AC4] a refused acceptance explains why on that request and keeps it listed', async () => {
    mockList(listOf([dateChange, description]));
    vi.spyOn(changeRequestsApi, 'acceptChangeRequest')
      .mockResolvedValueOnce({
        ok: false, kind: 'validation', message: 'Invalid change',
        details: ['Proposed date must be at least 14 days away.'],
      })
      .mockResolvedValueOnce({
        ok: false, kind: 'conflict', message: 'This event changed while you were deciding. Refresh and try again.',
      });
    const onAccepted = renderPanel();
    const card = await screen.findByTestId('change-request-mock-12-date');
    const other = screen.getByTestId('change-request-mock-12-description');

    fireEvent.click(within(card).getByRole('button', { name: 'Accept change' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Invalid change Proposed date must be at least 14 days away.');
    expect(within(other).queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(within(other).getByRole('button', { name: 'Accept change' }));
    expect(await within(other).findByRole('alert')).toHaveTextContent(
      'This event changed while you were deciding. Refresh and try again.',
    );
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(screen.getByTestId('change-request-mock-12-date')).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-66:AC1] a failed load says so and retries on request', async () => {
    const fetch = vi.spyOn(changeRequestsApi, 'fetchChangeRequests')
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' })
      .mockResolvedValueOnce({ ok: true, list: listOf([description]) });
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('change-request-mock-12-description')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[BOUNDARY] [SG2-66:AC1] a reply that lands after the panel closed is ignored', async () => {
    let resolve: (value: changeRequestsApi.FetchChangeRequestsResult) => void = () => {};
    vi.spyOn(changeRequestsApi, 'fetchChangeRequests').mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPanel();
    cleanup();
    await act(async () => resolve({ ok: true, list: listOf([attendance]) }));
    expect(screen.queryByTestId('change-request-mock-12-attendance')).not.toBeInTheDocument();
  });
});
