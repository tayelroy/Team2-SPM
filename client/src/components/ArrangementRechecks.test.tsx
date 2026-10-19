import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as changeRequestsApi from '../api/changeRequests';
import type { SettleRecheckResult } from '../api/changeRequests';
import * as eventRequestsApi from '../api/eventRequests';
import ArrangementRechecks from './ArrangementRechecks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stage: eventRequestsApi.EventStageResult = {
  event_id: 661,
  raw_status: 'planning',
  stage: 'Planning',
  stage_key: 'planning',
  description: 'Arrangements are being rechecked.',
  waiting_on: null,
  stepper_steps: [],
  arrangements_recheck_needed: true,
  // `venue` is legacy SG2-39 vocabulary with nothing to settle.
  outstanding_arrangements: ['venue_recheck', 'venue', 'equipment_recheck', 'registration_recheck'],
};

function renderBanner(onSettled = vi.fn()) {
  render(<ArrangementRechecks eventId={661} accessToken="coordinator-token" onSettled={onSettled} />);
  return onSettled;
}

describe('ArrangementRechecks (work queue)', () => {
  test('[NORMAL] [SG2-66:AC4] offers one settle button per outstanding recheck and reports a settled one', async () => {
    const loadStage = vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    let finish: (value: SettleRecheckResult) => void = () => {};
    const settle = vi.spyOn(changeRequestsApi, 'settleRecheck').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onSettled = renderBanner();

    const banner = await screen.findByTestId('arrangements-recheck-banner');
    expect(loadStage).toHaveBeenCalledWith(661, 'coordinator-token');
    expect(banner).toHaveTextContent('Arrangements need rechecking');
    expect(within(banner).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Mark venue rechecked',
      'Mark equipment rechecked',
      'Mark registrations rechecked',
    ]);

    fireEvent.click(within(banner).getByRole('button', { name: 'Mark equipment rechecked' }));
    expect(settle).toHaveBeenCalledWith(661, 'equipment_recheck', 'coordinator-token');
    for (const button of within(banner).getAllByRole('button')) expect(button).toBeDisabled();

    const settled = { event_id: 661, arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck' as const] };
    await act(async () => finish({ ok: true, settled }));
    expect(onSettled).toHaveBeenCalledWith(settled);
    expect(within(banner).getByRole('button', { name: 'Mark venue rechecked' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-66:AC4] a recheck that still fails lists its blockers; a later refusal replaces them', async () => {
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({ ok: true, stage });
    vi.spyOn(changeRequestsApi, 'settleRecheck')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'blocked',
        message: 'This arrangement still needs attention before it can be marked rechecked.',
        blockers: ['Registration has no closing time.'],
      })
      .mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'That arrangement is not waiting for a recheck.' });
    const onSettled = renderBanner();

    fireEvent.click(await screen.findByRole('button', { name: 'Mark registrations rechecked' }));
    const blockers = await screen.findByTestId('recheck-blockers');
    expect(blockers).toHaveAttribute('role', 'alert');
    expect(blockers).toHaveTextContent('This arrangement still needs attention before it can be marked rechecked.');
    expect(within(blockers).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Registration has no closing time.']);

    fireEvent.click(screen.getByRole('button', { name: 'Mark registrations rechecked' }));
    const failure = await screen.findByTestId('recheck-error');
    expect(failure).toHaveTextContent('That arrangement is not waiting for a recheck.');
    expect(within(failure).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recheck-blockers')).not.toBeInTheDocument();
    expect(onSettled).not.toHaveBeenCalled();
  });

  test.each([
    ['nothing needs rechecking', { ok: true as const, stage: { ...stage, arrangements_recheck_needed: false, outstanding_arrangements: [] } }],
    ['the stage cannot be read', { ok: false as const, kind: 'unavailable' as const, message: 'Could not reach the server. Please try again.' }],
  ])('[BOUNDARY] [SG2-66:AC4] shows nothing when %s', async (_label, result) => {
    const loadStage = vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue(result);
    const { container } = render(<ArrangementRechecks eventId={661} accessToken="t" onSettled={vi.fn()} />);
    await act(async () => {});
    expect(loadStage).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  test('[BOUNDARY] [SG2-66:AC4] a stage reply that lands after the banner closed is ignored', async () => {
    let resolve: (value: eventRequestsApi.GetEventStageOutcome) => void = () => {};
    vi.spyOn(eventRequestsApi, 'getEventStage').mockReturnValue(new Promise((r) => { resolve = r; }));
    renderBanner();
    cleanup();
    await act(async () => resolve({ ok: true, stage }));
    expect(screen.queryByTestId('arrangements-recheck-banner')).not.toBeInTheDocument();
  });
});
