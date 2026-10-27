import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as changeRequestsApi from '../api/changeRequests';
import type { ChangeRequest, ChangeRequestList, RefuseChangeRequestResult } from '../api/changeRequests';
import ChangeRequestsPanel from './ChangeRequestsPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const request: ChangeRequest = {
  id: '41',
  requested_at: '2026-10-19T02:00:00.000Z',
  reason: 'More guests confirmed.',
  status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 80, to: 90 }],
  significant: true,
  impact: { requires_revalidation: true, outstanding_arrangements: [], arrangements: [] },
};

function listed(status = 'planning', nextStepRequired = false): ChangeRequestList {
  return {
    event: { event_id: 12, status }, can_accept: true, next_step_required: nextStepRequired, change_requests: [request],
  };
}

const ACCEPTED = {
  ok: true as const,
  change: {
    event_id: 12, previous_status: 'needs_clarification', status: 'under_review', returned_to_planning: false,
    arrangements_recheck_needed: false, outstanding_arrangements: [],
  },
};

async function renderPanel(list: ChangeRequestList) {
  vi.spyOn(changeRequestsApi, 'fetchChangeRequests').mockResolvedValue({ ok: true, list });
  const onAccepted = vi.fn();
  render(<ChangeRequestsPanel eventId={12} accessToken="coordinator-token" onAccepted={onAccepted} />);
  const card = await screen.findByTestId('change-request-41');
  return { card, onAccepted };
}

function openRefusal(card: HTMLElement, reason: string) {
  fireEvent.click(within(card).getByRole('button', { name: 'Refuse change' }));
  fireEvent.change(within(card).getByLabelText('Reason for refusing'), { target: { value: reason } });
}

describe('ChangeRequestsPanel decisions (SG2-65)', () => {
  test('[NORMAL] [BOUNDARY] [CONFLICT] [SG2-65:AC2] the coordinator refuses only with a non-blank reason of up to 1000 characters; a request decided meanwhile stays listed, and a refusal does not reload the event', async () => {
    let resolve!: (value: RefuseChangeRequestResult) => void;
    const refuse = vi.spyOn(changeRequestsApi, 'refuseChangeRequest')
      .mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'This change request has already been decided.' })
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { card, onAccepted } = await renderPanel(listed());

    // BOUNDARY: a blank reason cannot be confirmed; the box holds at most 1000 characters; Cancel closes it.
    openRefusal(card, '   ');
    expect(within(card).getByRole('button', { name: 'Confirm refusal' })).toBeDisabled();
    expect(within(card).getByLabelText('Reason for refusing')).toHaveAttribute('maxLength', '1000');
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).queryByLabelText('Reason for refusing')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Accept change' })).toBeEnabled();
    expect(refuse).not.toHaveBeenCalled();

    // CONFLICT: decided in the meantime, so the message shows and the reason is kept.
    openRefusal(card, 'No.');
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Confirm refusal' })));
    expect(within(card).getByRole('alert')).toHaveTextContent('This change request has already been decided.');
    expect(within(card).getByLabelText('Reason for refusing')).toHaveValue('No.');

    // NORMAL: the trimmed reason is sent, the request leaves the list and the event is not reloaded.
    fireEvent.change(within(card).getByLabelText('Reason for refusing'), { target: { value: '  No larger room is free.  ' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm refusal' }));
    expect(within(card).getByRole('button', { name: 'Refusing change…' })).toBeDisabled();
    expect(refuse).toHaveBeenLastCalledWith(12, '41', 'No larger room is free.', 'coordinator-token');
    await act(async () => resolve({ ok: true }));
    expect(screen.queryByTestId('change-request-41')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Change refused. The event is unchanged and the organiser has been told why.');
    expect(onAccepted).not.toHaveBeenCalled();
  });

  test('[NORMAL] [FAILURE] [SG2-65:AC4] on a request returned for clarification the coordinator chooses back to review or resubmit; a failed acceptance keeps the request and shows why', async () => {
    const accept = vi.spyOn(changeRequestsApi, 'acceptChangeRequest')
      .mockResolvedValueOnce({
        ok: false, kind: 'validation', message: 'Choose whether the request goes back to review or the organiser resubmits it.',
      })
      .mockResolvedValueOnce(ACCEPTED);
    const { card, onAccepted } = await renderPanel(listed('needs_clarification', true));
    expect(within(card).queryByRole('button', { name: 'Accept change' })).not.toBeInTheDocument();

    // FAILURE: the request stays and the reason shows.
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Accept and ask organiser to resubmit' })));
    expect(accept).toHaveBeenLastCalledWith(12, '41', 'coordinator-token', 'resubmit');
    expect(within(card).getByRole('alert')).toHaveTextContent('Choose whether the request goes back to review');
    expect(onAccepted).not.toHaveBeenCalled();

    // NORMAL: back to review.
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Accept and return to review' })));
    expect(accept).toHaveBeenLastCalledWith(12, '41', 'coordinator-token', 'review');
    expect(onAccepted).toHaveBeenCalledWith(ACCEPTED.change);
    expect(screen.queryByTestId('change-request-41')).not.toBeInTheDocument();
  });
});
