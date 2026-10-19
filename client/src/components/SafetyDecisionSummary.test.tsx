import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/safetyChecks';
import type { FetchSafetyDecisionsResult, SafetyDecision } from '../api/safetyChecks';
import SafetyDecisionSummary, { type SafetyDecisionSummaryProps } from './SafetyDecisionSummary';
import { formatSgtTimestamp } from './EventAuditDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const REJECTED: SafetyDecision = {
  decision_id: 9, event_id: 12, decision: 'reject', reason: 'Fire exit blocked', arrangements: [],
  decided_by: 'safety-1', decided_by_name: 'Sam Safety', decided_at: '2030-06-01T00:00:00.000Z',
};
const EARLIER: SafetyDecision = { ...REJECTED, decision_id: 4, decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'] };
const APPROVED: SafetyDecision = { ...REJECTED, decision_id: 11, decision: 'approve', reason: null, decided_by_name: null };

const decisions = (list: SafetyDecision[]) => vi.spyOn(api, 'fetchSafetyDecisions').mockResolvedValue({ ok: true, decisions: list });

function renderSummary(props: Partial<SafetyDecisionSummaryProps> = {}) {
  const onReworked = vi.fn();
  const view = render(
    <SafetyDecisionSummary eventId={12} accessToken="token" status="safety_rejected" canRework onReworked={onReworked} {...props} />,
  );
  return { onReworked, view };
}

describe('SafetyDecisionSummary (SG2-92 AC4–AC6)', () => {
  test('[NORMAL] [SG2-92:AC4] [SG2-92:AC6] the latest decision shows what, why, who and when, and the coordinator reworks it', async () => {
    decisions([REJECTED, EARLIER]);
    const rework = vi.spyOn(api, 'reworkSafetyRejectedEvent').mockResolvedValue({ ok: true, status: 'planning' });
    const { onReworked } = renderSummary();
    const summary = await screen.findByTestId('safety-decision-summary');
    expect(summary).toHaveTextContent('Rejected');
    expect(summary).toHaveTextContent('Fire exit blocked');
    expect(summary).toHaveTextContent('Sam Safety');
    expect(summary).toHaveTextContent(formatSgtTimestamp(REJECTED.decided_at));
    expect(summary).not.toHaveTextContent('Widen the aisles');
    expect(summary).toHaveTextContent('This event did not pass its safety check. Rework the arrangements, then resubmit them for a new safety check.');
    fireEvent.click(screen.getByRole('button', { name: 'Rework arrangements' }));
    expect(screen.getByRole('button', { name: 'Reworking arrangements…' })).toBeDisabled();
    await act(async () => {});
    expect(rework).toHaveBeenCalledWith(12, 'token');
    expect(onReworked).toHaveBeenCalledTimes(1);
  });

  test('[NORMAL] [SG2-92:AC6] the organiser sees requested changes with the named arrangements, and no rework', async () => {
    decisions([EARLIER]);
    renderSummary({ status: 'planning', canRework: false });
    const summary = await screen.findByTestId('safety-decision-summary');
    expect(summary).toHaveTextContent('Changes requested');
    expect(summary).toHaveTextContent('Arrangements to changeVenue, Other');
    expect(screen.queryByRole('button', { name: 'Rework arrangements' })).toBeNull();
  });

  test('[BOUNDARY] [SG2-92:AC6] an approval without a note or a known name reads plainly', async () => {
    decisions([APPROVED]);
    renderSummary({ status: 'preparation', canRework: false });
    const summary = await screen.findByTestId('safety-decision-summary');
    expect(summary).toHaveTextContent('Approved');
    expect(summary).not.toHaveTextContent('Reason');
    expect(summary).not.toHaveTextContent('Arrangements to change');
    expect(summary).toHaveTextContent('Recorded bySafety Officer');
  });

  test('[BOUNDARY] [SG2-92:AC4] nothing is shown without a decision unless a rejected event still needs reworking', async () => {
    const fetch = decisions([]);
    const { view } = renderSummary({ status: 'planning' });
    await act(async () => {});
    expect(screen.queryByTestId('safety-decision-summary')).toBeNull();
    view.rerender(<SafetyDecisionSummary eventId={12} accessToken="token" status="safety_rejected" canRework onReworked={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Rework arrangements' })).toBeVisible();
    // A status change re-reads the decisions.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[FAILURE] [SG2-92:AC6] an unreadable history is reported and retried', async () => {
    const fetch = vi.spyOn(api, 'fetchSafetyDecisions')
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'History is down.' })
      .mockResolvedValueOnce({ ok: true, decisions: [REJECTED] });
    renderSummary({ canRework: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('History is down.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Fire exit blocked')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[CONFLICT] [SG2-92:AC4] a refused rework keeps the button and says why', async () => {
    decisions([REJECTED]);
    vi.spyOn(api, 'reworkSafetyRejectedEvent').mockResolvedValue({ ok: false, kind: 'conflict', message: 'Only a Safety Rejected event can be reworked.' });
    const { onReworked } = renderSummary();
    fireEvent.click(await screen.findByRole('button', { name: 'Rework arrangements' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a Safety Rejected event can be reworked.');
    expect(screen.getByRole('button', { name: 'Rework arrangements' })).toBeEnabled();
    expect(onReworked).not.toHaveBeenCalled();
  });

  test('[CONFLICT] [SG2-92:AC6] a history reply after unmounting is ignored', async () => {
    // The client's ES2020 lib has no Promise.withResolvers, so the executor form holds the resolver.
    let resolve!: (value: FetchSafetyDecisionsResult) => void;
    vi.spyOn(api, 'fetchSafetyDecisions').mockReturnValue(new Promise((done) => { resolve = done; }));
    const { view } = renderSummary();
    view.unmount();
    await act(async () => resolve({ ok: true, decisions: [REJECTED] }));
    expect(screen.queryByTestId('safety-decision-summary')).toBeNull();
  });
});
