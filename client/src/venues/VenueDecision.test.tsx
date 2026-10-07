import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import VenueDecision from './VenueDecision';
import type { BookingReadiness } from './suitabilityApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const decided = (status: string, reason: string | null = null) => ({ request: {
  request_id: 41, event_id: 7, venue_id: 1, venue_name: 'Atrium Hall', status, starts_at: '2030-06-15T02:00:00.000Z',
  ends_at: '2030-06-15T10:00:00.000Z', layout: 'theatre', venue_requirements: null, requester_name: 'Casey',
  requested_at: '2030-01-01T00:00:00.000Z', decider_name: 'Vera', decided_at: '2030-01-02T00:00:00.000Z', decision_reason: reason } });

function panel(readiness: BookingReadiness | null = 'allowed', holdId: number | null = null) {
  const onDecided = vi.fn();
  render(<VenueDecision requestId={41} accessToken="staff-token" holdId={holdId} readiness={readiness} onDecided={onDecided} />);
  return onDecided;
}

test('[NORMAL] [SG2-49:AC1] approving a ready request commits it and says the coordinator was notified', async () => {
  let reply!: (response: Response) => void;
  const fetch = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { reply = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const onDecided = panel();
  fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
  expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject with reason' })).toBeDisabled();
  await act(async () => reply(Response.json(decided('approved'))));
  expect(screen.getByRole('status')).toHaveTextContent('Approved. The venue is committed to this event and the coordinator has been notified.');
  expect(onDecided).toHaveBeenCalledWith('approved');
  expect(fetch.mock.calls[0][0]).toBe('/api/venue-booking-requests/41/decision');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ decision: 'approve', reason: null });
});

test('[NORMAL] [SG2-49:AC2] rejecting sends the trimmed reason and confirms the coordinator can see it', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(decided('rejected', 'Rewiring')));
  vi.stubGlobal('fetch', fetch);
  const onDecided = panel();
  fireEvent.change(screen.getByLabelText('Decision note (required to reject; shared with the coordinator)'), { target: { value: '  Rewiring  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject with reason' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Rejected. The coordinator has been notified and can see your reason.');
  expect(onDecided).toHaveBeenCalledWith('rejected');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ decision: 'reject', reason: 'Rewiring' });
});

test('[BOUNDARY] [SG2-49:AC2] a rejection without a reason is stopped before sending; the note is capped at 500 characters', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  panel();
  expect(screen.getByLabelText('Decision note (required to reject; shared with the coordinator)')).toHaveAttribute('maxLength', '500');
  fireEvent.change(screen.getByLabelText('Decision note (required to reject; shared with the coordinator)'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject with reason' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for rejecting this request. The coordinator will see it.');
  expect(fetch).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-49:AC1] [SG2-47:AC3] Approve waits for the suitability check and stays off until a capacity exception or facility allows it', () => {
  const cases: [BookingReadiness | null, string][] = [
    [null, 'Checking whether this booking can be approved…'],
    ['needs_capacity_exception', 'Approve a capacity exception above before approving the booking.'],
    ['blocked', 'A required facility is missing, so this booking cannot be approved. You can still reject it.']
  ];
  for (const [readiness, hint] of cases) {
    panel(readiness);
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve booking' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject with reason' })).toBeEnabled();
    cleanup();
  }
});

test('[CONFLICT] [SG2-49:AC1] a conflict found at the moment of approval is shown and the request can still be decided', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Atrium Hall is already booked for Board Dinner during this period.' }, { status: 409 })));
  const onDecided = panel();
  fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Atrium Hall is already booked for Board Dinner during this period.');
  expect(screen.getByRole('button', { name: 'Reject with reason' })).toBeEnabled();
  expect(onDecided).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-49:AC1] a request created by a tentative hold points to Venue holds instead of offering a decision', () => {
  panel('allowed', 12);
  expect(screen.getByText('This request belongs to tentative hold #12. Convert or release it from Venue holds.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
});
