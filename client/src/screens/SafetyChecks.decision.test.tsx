import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/safetyChecks';
import type {
  FetchSafetyDecisionsResult,
  RecordSafetyDecisionResult,
  SafetyCheckEvent,
  SafetyDecision,
} from '../api/safetyChecks';
import SafetyChecks from './SafetyChecks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GALA: SafetyCheckEvent = {
  eventId: 12, revision: 4, name: 'Harbour Gala', organisation: 'SMU', proposedDate: '2030-06-20T02:00:00.000Z',
  awaitingSince: '2030-06-01T02:00:00.000Z', expectedAttendance: 300, accessibilityNeeds: 'Step-free access',
  expectedCrowdMovement: null, venues: [], equipment: [],
};
const TALK: SafetyCheckEvent = { ...GALA, eventId: 13, revision: 1, name: 'Quiet Talk' };
const EARLIER: SafetyDecision = {
  decision_id: 3, event_id: 12, decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'],
  decided_by: 'safety-1', decided_by_name: 'Sam Safety', decided_at: '2030-06-01T00:00:00.000Z',
};
const STALE = 'This event changed after you opened it. Refresh the safety checks and review it again.';

/** Each read of the list answers with the next set of events, the last repeating. */
function lists(...sets: SafetyCheckEvent[][]) {
  const fetch = vi.spyOn(api, 'fetchSafetyChecks');
  for (const events of sets) fetch.mockResolvedValueOnce({ ok: true, events });
  fetch.mockResolvedValue({ ok: true, events: sets.at(-1)! });
  return fetch;
}
function history(decisions: SafetyDecision[] = []) {
  return vi.spyOn(api, 'fetchSafetyDecisions').mockResolvedValue({ ok: true, decisions, rereviews: [] });
}
const recorded = (decision: SafetyDecision['decision']): RecordSafetyDecisionResult => ({
  ok: true,
  recorded: { decision: { ...EARLIER, decision_id: 9, decision }, previous_status: 'awaiting_safety_check', status: 'preparation' },
});
const galaDecision = async () => within(await screen.findByRole('region', { name: 'Safety decision for Harbour Gala' }));

describe('the decision history on each review (SG2-92 AC6)', () => {
  test('[NORMAL] [SG2-92:AC6] each event awaiting a check shows its earlier decisions, with who decided and why', async () => {
    lists([GALA]);
    const read = history([EARLIER]);
    render(<SafetyChecks accessToken="safety-token" />);
    const review = await galaDecision();
    const earlier = await review.findByRole('list', { name: 'Earlier safety decisions' });
    expect(earlier).toHaveTextContent('Changes requested');
    expect(earlier).toHaveTextContent('Widen the aisles');
    expect(earlier).toHaveTextContent('Venue, Other');
    expect(earlier).toHaveTextContent('Sam Safety');
    expect(read).toHaveBeenCalledWith(12, 'safety-token');
  });

  test('[BOUNDARY] [SG2-92:AC6] an event never decided says so', async () => {
    lists([GALA]);
    history();
    render(<SafetyChecks accessToken="t" />);
    expect(await (await galaDecision()).findByText('No earlier safety decisions on this event.')).toBeVisible();
  });

  test('[FAILURE] [SG2-92:AC6] an unreadable history is shown inside the review without blocking the decision', async () => {
    lists([GALA]);
    vi.spyOn(api, 'fetchSafetyDecisions').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'History is down.' });
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    expect(await review.findByRole('alert')).toHaveTextContent('History is down.');
    expect(review.getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-92:AC6] a history arriving after leaving the screen is ignored', async () => {
    lists([GALA]);
    // The client's ES2020 lib has no Promise.withResolvers, so the executor form holds the resolver.
    let resolveHistory!: (value: FetchSafetyDecisionsResult) => void;
    vi.spyOn(api, 'fetchSafetyDecisions').mockReturnValue(new Promise((resolve) => { resolveHistory = resolve; }));
    render(<SafetyChecks accessToken="t" />);
    expect((await galaDecision()).getByRole('status')).toHaveTextContent('Loading earlier decisions…');
    cleanup();
    await act(async () => resolveHistory({ ok: true, decisions: [EARLIER], rereviews: [] }));
    expect(screen.queryByRole('list', { name: 'Earlier safety decisions' })).toBeNull();
  });
});

describe('the decision form on each review (SG2-92 AC1–AC5)', () => {
  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC3] [SG2-92:AC5] approving records the decision on the reviewed revision, re-reads the list without the event and says who was told', async () => {
    const list = lists([GALA, TALK], [TALK]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('approve'));
    render(<SafetyChecks accessToken="safety-token" />);
    const review = await galaDecision();
    expect(review.getByText('Required to reject or request changes; optional to approve. 0 of 2000 characters.')).toBeVisible();
    fireEvent.click(review.getByRole('radio', { name: 'Approve' }));
    expect(review.queryByRole('group', { name: 'Arrangements to change' })).toBeNull();
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('Approved for Harbour Gala. The organiser and the coordinator have been notified.')).toHaveAttribute('role', 'status');
    expect(record).toHaveBeenCalledWith(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 'safety-token');
    expect(screen.queryByRole('article', { name: 'Harbour Gala' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Quiet Talk' })).toBeVisible();
    expect(list).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('article', { name: 'Quiet Talk' })).toBeVisible();
    expect(screen.queryByText(/Approved for Harbour Gala/)).toBeNull();
  });

  test('[NORMAL] [SG2-92:AC4] deciding the event a desk card opened returns to the list, which says when it is empty', async () => {
    lists([GALA], []);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('reject'));
    render(<SafetyChecks accessToken="t" focusEventId={12} />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Reject' }));
    fireEvent.change(review.getByLabelText('Reason'), { target: { value: 'Fire exit blocked' } });
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'No events awaiting a safety check' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Rejected for Harbour Gala. The organiser and the coordinator have been notified.');
    expect(screen.queryByText(/That event is no longer awaiting/)).toBeNull();
  });

  test('[BOUNDARY] [SG2-92:AC5] a decision on an event with no name says which one it was', async () => {
    lists([{ ...TALK, name: '  ' }], []);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('approve'));
    render(<SafetyChecks accessToken="t" />);
    const review = within(await screen.findByRole('region', { name: 'Safety decision for Untitled event' }));
    fireEvent.click(review.getByRole('radio', { name: 'Approve' }));
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    await screen.findByRole('heading', { level: 2, name: 'No events awaiting a safety check' });
    expect(screen.getByText('Approved for Untitled event. The organiser and the coordinator have been notified.')).toBeVisible();
  });

  test('[NORMAL] [SG2-92:AC2] requesting changes names the arrangements in a fixed order with the reason', async () => {
    lists([GALA], []);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue(recorded('request_changes'));
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Request changes' }));
    expect(review.getByText(/^Required\./)).toBeVisible();
    expect(review.getByLabelText('Reason')).toHaveAttribute('aria-required', 'true');
    const named = within(review.getByRole('group', { name: 'Arrangements to change' }));
    fireEvent.click(named.getByRole('checkbox', { name: 'Other' }));
    fireEvent.click(named.getByRole('checkbox', { name: 'Venue' }));
    fireEvent.click(named.getByRole('checkbox', { name: 'Equipment and technical' }));
    fireEvent.click(named.getByRole('checkbox', { name: 'Equipment and technical' }));
    fireEvent.change(review.getByLabelText('Reason'), { target: { value: 'Widen the aisles' } });
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    await screen.findByText(/Changes requested for Harbour Gala/);
    expect(record).toHaveBeenCalledWith(12, { decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'] }, 4, 't');
  });

  test('[FAILURE] [SG2-92:AC2] nothing is sent without a decision, a reason to reject, or an arrangement to change', async () => {
    lists([GALA]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision');
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(review.getByRole('alert')).toHaveTextContent('Choose Approve, Reject or Request changes.');
    fireEvent.click(review.getByRole('radio', { name: 'Reject' }));
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(review.getByRole('alert')).toHaveTextContent('Give a reason to reject this event.');
    fireEvent.click(review.getByRole('radio', { name: 'Request changes' }));
    fireEvent.change(review.getByLabelText('Reason'), { target: { value: 'Widen the aisles' } });
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(review.getByRole('alert')).toHaveTextContent('Name at least one arrangement to change.');
    expect(record).not.toHaveBeenCalled();
  });

  test('[FAILURE] [SG2-92:AC1] an unreachable server keeps the decision on screen so it can be sent again', async () => {
    lists([GALA]);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' });
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Reject' }));
    fireEvent.change(review.getByLabelText('Reason'), { target: { value: 'Fire exit blocked' } });
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(await review.findByRole('alert')).toHaveTextContent(/^Could not reach the server\. Please try again\.$/);
    expect(review.getByLabelText('Reason')).toHaveValue('Fire exit blocked');
    expect(review.getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-92:AC1] a refusal from the server is shown with its details and the event stays listed', async () => {
    const list = lists([GALA]);
    history();
    vi.spyOn(api, 'recordSafetyDecision').mockResolvedValue({
      ok: false, kind: 'conflict', message: 'This event is no longer awaiting a safety check.', status: 'preparation', details: ['Refresh the list.'],
    });
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Approve' }));
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    const alert = await review.findByRole('alert');
    expect(alert).toHaveTextContent('This event is no longer awaiting a safety check.');
    expect(alert).toHaveTextContent('Refresh the list.');
    expect(screen.getByRole('article', { name: 'Harbour Gala' })).toBeVisible();
    expect(list).toHaveBeenCalledTimes(1);
  });

  test('[CONFLICT] [SG2-92:AC1] a decision on details that changed since the review opened is refused, the list re-read, and the next decision sends the new revision', async () => {
    const list = lists([GALA], [{ ...GALA, revision: 5, expectedAttendance: 450 }]);
    history();
    const record = vi.spyOn(api, 'recordSafetyDecision')
      .mockResolvedValueOnce({ ok: false, kind: 'stale', message: STALE })
      .mockResolvedValueOnce(recorded('approve'));
    render(<SafetyChecks accessToken="t" focusEventId={12} />);
    let review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Approve' }));
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText(STALE)).toHaveAttribute('role', 'status');
    expect(list).toHaveBeenCalledTimes(2);
    // Still the one event the desk card opened, now as it stands.
    expect(screen.getByRole('region', { name: 'Safety check for Harbour Gala' })).toBeVisible();
    expect(screen.getByText('450')).toBeVisible();
    review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Approve' }));
    fireEvent.click(review.getByRole('button', { name: 'Record decision' }));
    await screen.findByText(/Approved for Harbour Gala/);
    expect(record.mock.calls.map((call) => call[2])).toEqual([4, 5]);
  });

  test('[CONFLICT] [SG2-92:AC1] a second submit while recording sends one request, and the form is locked meanwhile', async () => {
    lists([GALA], []);
    history();
    let resolve!: (value: RecordSafetyDecisionResult) => void;
    const record = vi.spyOn(api, 'recordSafetyDecision').mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SafetyChecks accessToken="t" />);
    const review = await galaDecision();
    fireEvent.click(review.getByRole('radio', { name: 'Reject' }));
    fireEvent.change(review.getByLabelText('Reason'), { target: { value: 'Fire exit blocked' } });
    const form = review.getByRole('form', { name: 'Record a safety decision' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(review.getByRole('button', { name: 'Recording decision…' })).toBeDisabled();
    expect(review.getByLabelText('Reason')).toBeDisabled();
    await act(async () => resolve(recorded('reject')));
    await waitFor(() => expect(screen.getByText(/Rejected for Harbour Gala/)).toBeVisible());
    expect(record).toHaveBeenCalledTimes(1);
  });
});
