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
  test('[NORMAL] [SG2-65:AC2] the coordinator refuses with a reason, the request leaves the list and the event is not reloaded', async () => {
    let resolve!: (value: RefuseChangeRequestResult) => void;
    const refuse = vi.spyOn(changeRequestsApi, 'refuseChangeRequest')
      .mockReturnValue(new Promise((done) => { resolve = done; }));
    const { card, onAccepted } = await renderPanel(listed());
    openRefusal(card, '  No larger room is free.  ');
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm refusal' }));

    expect(within(card).getByRole('button', { name: 'Refusing change…' })).toBeDisabled();
    expect(refuse).toHaveBeenCalledWith(12, '41', 'No larger room is free.', 'coordinator-token');
    await act(async () => resolve({ ok: true }));
    expect(screen.queryByTestId('change-request-41')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Change refused. The event is unchanged and the organiser has been told why.');
    expect(onAccepted).not.toHaveBeenCalled();
  });

  test('[BOUNDARY] [SG2-65:AC2] Confirm refusal stays disabled until a non-blank reason is given, and the reason is capped at 1000 characters', async () => {
    const refuse = vi.spyOn(changeRequestsApi, 'refuseChangeRequest');
    const { card } = await renderPanel(listed());
    openRefusal(card, '   ');
    expect(within(card).getByRole('button', { name: 'Confirm refusal' })).toBeDisabled();
    expect(within(card).getByLabelText('Reason for refusing')).toHaveAttribute('maxLength', '1000');
    fireEvent.change(within(card).getByLabelText('Reason for refusing'), { target: { value: 'r' } });
    expect(within(card).getByRole('button', { name: 'Confirm refusal' })).toBeEnabled();
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).queryByLabelText('Reason for refusing')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Accept change' })).toBeEnabled();
    expect(refuse).not.toHaveBeenCalled();
  });

  test('[NORMAL] [SG2-65:AC4] on a request returned for clarification the coordinator accepts and chooses back to review or resubmit', async () => {
    const accept = vi.spyOn(changeRequestsApi, 'acceptChangeRequest').mockResolvedValue(ACCEPTED);
    const { card, onAccepted } = await renderPanel(listed('needs_clarification', true));
    expect(within(card).queryByRole('button', { name: 'Accept change' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Accept and ask organiser to resubmit' })).toBeEnabled();
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Accept and return to review' })));
    expect(accept).toHaveBeenCalledWith(12, '41', 'coordinator-token', 'review');
    expect(onAccepted).toHaveBeenCalledWith(ACCEPTED.change);
    expect(screen.queryByTestId('change-request-41')).not.toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-65:AC2] a request decided in the meantime shows the server message and stays listed', async () => {
    vi.spyOn(changeRequestsApi, 'refuseChangeRequest').mockResolvedValue({
      ok: false, kind: 'conflict', message: 'This change request has already been decided.',
    });
    const { card } = await renderPanel(listed());
    openRefusal(card, 'No.');
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Confirm refusal' })));
    expect(within(card).getByRole('alert')).toHaveTextContent('This change request has already been decided.');
    expect(within(card).getByLabelText('Reason for refusing')).toHaveValue('No.');
  });

  test('[FAILURE] [SG2-65:AC4] a failed clarification acceptance keeps the request and shows why', async () => {
    vi.spyOn(changeRequestsApi, 'acceptChangeRequest').mockResolvedValue({
      ok: false, kind: 'validation', message: 'Choose whether the request goes back to review or the organiser resubmits it.',
    });
    const { card, onAccepted } = await renderPanel(listed('needs_clarification', true));
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Accept and ask organiser to resubmit' })));
    expect(within(card).getByRole('alert')).toHaveTextContent('Choose whether the request goes back to review');
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
