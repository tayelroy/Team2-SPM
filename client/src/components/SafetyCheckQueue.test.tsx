import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/safetyChecks';
import type {
  FetchSafetyCheckQueueResult,
  FetchSafetyDecisionsResult,
  RecordSafetyDecisionResult,
  SafetyCheckEvent,
  SafetyDecision,
} from '../api/safetyChecks';
import SafetyCheckQueue from './SafetyCheckQueue';
import { formatSgtTimestamp } from './EventAuditDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GALA: SafetyCheckEvent = {
  event_id: 12, name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00.000Z', expected_attendance: 300,
  accessibility_needs: 'Step-free access', coordinator_name: 'Casey Coordinator',
  venues: [{ name: 'Harbour Hall', capacity: 400, starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
  equipment: [{ name: 'Wireless microphone', quantity: 2, placement_position: 'Stage left' }],
};
const BARE: SafetyCheckEvent = {
  event_id: 13, name: '  ', proposed_date: null, expected_attendance: null, accessibility_needs: null, coordinator_name: null,
  venues: [{ name: 'Annex', capacity: null, starts_at: null, ends_at: null }],
  equipment: [{ name: 'Lectern', quantity: 1, placement_position: null }],
};
const EMPTY: SafetyCheckEvent = { ...BARE, event_id: 14, name: 'Quiet Talk', venues: [], equipment: [] };
const EARLIER: SafetyDecision = {
  decision_id: 3, event_id: 12, decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'],
  decided_by: 'safety-1', decided_by_name: 'Sam Safety', decided_at: '2030-06-01T00:00:00.000Z',
};

function queue(events: SafetyCheckEvent[]) {
  return vi.spyOn(api, 'fetchSafetyCheckQueue').mockResolvedValue({ ok: true, queue: { source: 'stand-in', events } });
}
function history(decisions: SafetyDecision[] = []) {
  return vi.spyOn(api, 'fetchSafetyDecisions').mockResolvedValue({ ok: true, decisions });
}
const recorded = (decision: SafetyDecision['decision']): RecordSafetyDecisionResult => ({
  ok: true,
  recorded: { decision: { ...EARLIER, decision_id: 9, decision }, previous_status: 'awaiting_safety_check', status: 'preparation' },
});

async function openGala() {
  fireEvent.click(await screen.findByRole('button', { name: /Harbour Gala/ }));
  return screen.getByTestId('safety-review');
}

describe('SafetyCheckQueue (SG2-92; list is a stand-in for SG2-91)', () => {
  test('[NORMAL] [SG2-92:AC1] lists the events awaiting a check under the stand-in note and opens one for review', async () => {
    queue([GALA, BARE]);
    history([EARLIER]);
    render(<SafetyCheckQueue accessToken="safety-token" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading safety checks…');
    expect(screen.getByTestId('safety-check-stand-in-note')).toHaveTextContent('This list is a stand-in for SG2-91 until it ships.');
    expect(await screen.findByRole('button', { name: /Untitled event/ })).toHaveTextContent('Date not set · ? expected');
    expect(screen.getByText('Choose an event to review its arrangements and record a decision.')).toBeVisible();

    const review = await openGala();
    expect(screen.getByRole('button', { name: /Harbour Gala/ })).toHaveAttribute('aria-pressed', 'true');
    expect(review).toHaveTextContent(formatSgtTimestamp(GALA.proposed_date!));
    expect(review).toHaveTextContent('Expected attendance300');
    expect(review).toHaveTextContent('Step-free access');
    expect(review).toHaveTextContent('Casey Coordinator');
    expect(review).toHaveTextContent(`Harbour Hall: capacity 400, ${formatSgtTimestamp(GALA.venues[0].starts_at!)} – ${formatSgtTimestamp(GALA.venues[0].ends_at!)}`);
    expect(review).toHaveTextContent('Wireless microphone × 2, placed Stage left');
    // AC6: the earlier decisions on the event, with who and why.
    const earlier = await within(review).findByRole('list', { name: 'Earlier safety decisions' });
    expect(earlier).toHaveTextContent('Changes requested');
    expect(earlier).toHaveTextContent('Widen the aisles');
    expect(earlier).toHaveTextContent('Venue, Other');
    expect(earlier).toHaveTextContent('Sam Safety');
  });

  test('[BOUNDARY] [SG2-92:AC1] missing details read plainly, and an event with no arrangements says so', async () => {
    queue([BARE, EMPTY]);
    history();
    render(<SafetyCheckQueue accessToken="t" />);
    fireEvent.click(await screen.findByRole('button', { name: /Untitled event/ }));
    let review = screen.getByTestId('safety-review');
    expect(review).toHaveTextContent('Event dateNot set');
    expect(review).toHaveTextContent('Expected attendanceNot set');
    expect(review).toHaveTextContent('None recorded');
    expect(review).toHaveTextContent('Not assigned');
    expect(review).toHaveTextContent('Annex: capacity unknown');
    expect(review).toHaveTextContent('Lectern × 1');
    expect(await within(review).findByText('No earlier safety decisions on this event.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Quiet Talk/ }));
    review = screen.getByTestId('safety-review');
    expect(review).toHaveTextContent('No confirmed venue booking.');
    expect(review).toHaveTextContent('No equipment requested.');
  });

  test('[BOUNDARY] [SG2-92:AC1] an empty queue says nothing is waiting', async () => {
    queue([]);
    render(<SafetyCheckQueue accessToken="t" />);
    expect(await screen.findByText('No events are awaiting a safety check.')).toBeVisible();
  });

  test('[FAILURE] [SG2-92:AC1] an unreadable queue shows the reason and retries', async () => {
    const fetch = vi.spyOn(api, 'fetchSafetyCheckQueue')
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' })
      .mockResolvedValueOnce({ ok: true, queue: { source: 'stand-in', events: [GALA] } });
    render(<SafetyCheckQueue accessToken="t" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Harbour Gala/ })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[FAILURE] [SG2-92:AC6] an unreadable history is shown inside the review without blocking the decision', async () => {
    queue([GALA]);
    vi.spyOn(api, 'fetchSafetyDecisions').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'History is down.' });
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    expect(within(review).getByRole('status')).toHaveTextContent('Loading earlier decisions…');
    expect(await within(review).findByRole('alert')).toHaveTextContent('History is down.');
    expect(within(review).getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-92:AC1] a reply that arrives after leaving the page is ignored', async () => {
    // The client's ES2020 lib has no Promise.withResolvers, so the executor form holds the resolver.
    let resolveQueue!: (value: FetchSafetyCheckQueueResult) => void;
    vi.spyOn(api, 'fetchSafetyCheckQueue').mockReturnValue(new Promise((resolve) => { resolveQueue = resolve; }));
    const { unmount } = render(<SafetyCheckQueue accessToken="t" />);
    unmount();
    await act(async () => resolveQueue({ ok: true, queue: { source: 'stand-in', events: [GALA] } }));
    queue([GALA]);
    let resolveHistory!: (value: FetchSafetyDecisionsResult) => void;
    vi.spyOn(api, 'fetchSafetyDecisions').mockReturnValue(new Promise((resolve) => { resolveHistory = resolve; }));
    render(<SafetyCheckQueue accessToken="t" />);
    await openGala();
    cleanup();
    await act(async () => resolveHistory({ ok: true, decisions: [EARLIER] }));
    expect(screen.queryByTestId('safety-review')).toBeNull();
  });
});

describe('SafetyDecisionForm inside the review (SG2-92 AC1–AC5)', () => {
  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC3] [SG2-92:AC5] approving records the decision, removes the event and says who was told', async () => {
    queue([GALA, BARE]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('approve'));
    render(<SafetyCheckQueue accessToken="safety-token" />);
    const review = await openGala();
    expect(within(review).getByText('Required to reject or request changes; optional to approve. 0 of 2000 characters.')).toBeVisible();
    fireEvent.click(within(review).getByRole('radio', { name: 'Approve' }));
    expect(within(review).queryByRole('group', { name: 'Arrangements to change' })).toBeNull();
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Approved for Harbour Gala. The organiser and the coordinator have been notified.');
    expect(record).toHaveBeenCalledWith(12, { decision: 'approve', reason: '', arrangements: [] }, 'safety-token');
    expect(screen.queryByRole('button', { name: /Harbour Gala/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Untitled event/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Untitled event/ }));
    expect(screen.queryByText(/Approved for Harbour Gala/)).toBeNull();
  });

  test('[NORMAL] [SG2-92:AC2] requesting changes names the arrangements in a fixed order with the reason', async () => {
    queue([GALA]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('request_changes'));
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    fireEvent.click(within(review).getByRole('radio', { name: 'Request changes' }));
    expect(within(review).getByText(/^Required\./)).toBeVisible();
    expect(within(review).getByLabelText('Reason')).toHaveAttribute('aria-required', 'true');
    const named = within(review).getByRole('group', { name: 'Arrangements to change' });
    fireEvent.click(within(named).getByRole('checkbox', { name: 'Other' }));
    fireEvent.click(within(named).getByRole('checkbox', { name: 'Venue' }));
    fireEvent.click(within(named).getByRole('checkbox', { name: 'Equipment and technical' }));
    fireEvent.click(within(named).getByRole('checkbox', { name: 'Equipment and technical' }));
    fireEvent.change(within(review).getByLabelText('Reason'), { target: { value: 'Widen the aisles' } });
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    await screen.findByText(/Changes requested for Harbour Gala/);
    expect(record).toHaveBeenCalledWith(12, { decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'] }, 't');
  });

  test('[FAILURE] [SG2-92:AC2] nothing is sent without a decision, a reason to reject, or an arrangement to change', async () => {
    queue([GALA]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision');
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    expect(within(review).getByRole('alert')).toHaveTextContent('Choose Approve, Reject or Request changes.');
    fireEvent.click(within(review).getByRole('radio', { name: 'Reject' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    expect(within(review).getByRole('alert')).toHaveTextContent('Give a reason to reject this event.');
    fireEvent.click(within(review).getByRole('radio', { name: 'Request changes' }));
    fireEvent.change(within(review).getByLabelText('Reason'), { target: { value: 'Widen the aisles' } });
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    expect(within(review).getByRole('alert')).toHaveTextContent('Name at least one arrangement to change.');
    expect(record).not.toHaveBeenCalled();
  });

  test('[FAILURE] [SG2-92:AC1] an unreachable server keeps the decision on screen so it can be sent again', async () => {
    queue([GALA]);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' });
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    fireEvent.click(within(review).getByRole('radio', { name: 'Reject' }));
    fireEvent.change(within(review).getByLabelText('Reason'), { target: { value: 'Fire exit blocked' } });
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    expect(await within(review).findByRole('alert')).toHaveTextContent(/^Could not reach the server\. Please try again\.$/);
    expect(within(review).getByLabelText('Reason')).toHaveValue('Fire exit blocked');
    expect(within(review).getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-92:AC1] a refusal from the server is shown with its details and the event stays listed', async () => {
    queue([GALA]);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue({
      ok: false, kind: 'conflict', message: 'This event is no longer awaiting a safety check.', status: 'preparation', details: ['Refresh the list.'],
    });
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    fireEvent.click(within(review).getByRole('radio', { name: 'Approve' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Record decision' }));
    const alert = await within(review).findByRole('alert');
    expect(alert).toHaveTextContent('This event is no longer awaiting a safety check.');
    expect(alert).toHaveTextContent('Refresh the list.');
    expect(screen.getByRole('button', { name: /Harbour Gala/ })).toBeVisible();
  });

  test('[CONFLICT] [SG2-92:AC1] a second submit while recording sends one request, and the form is locked meanwhile', async () => {
    queue([GALA]);
    history();
    let resolve!: (value: RecordSafetyDecisionResult) => void;
    const record = vi.spyOn(api, 'recordSafetyDecision').mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SafetyCheckQueue accessToken="t" />);
    const review = await openGala();
    fireEvent.click(within(review).getByRole('radio', { name: 'Reject' }));
    fireEvent.change(within(review).getByLabelText('Reason'), { target: { value: 'Fire exit blocked' } });
    const form = within(review).getByRole('form', { name: 'Record a safety decision' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(within(review).getByRole('button', { name: 'Recording decision…' })).toBeDisabled();
    expect(within(review).getByLabelText('Reason')).toBeDisabled();
    await act(async () => resolve(recorded('reject')));
    await waitFor(() => expect(screen.getByText(/Rejected for Harbour Gala/)).toBeVisible());
    expect(record).toHaveBeenCalledTimes(1);
  });
});
