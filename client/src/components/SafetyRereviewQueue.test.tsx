import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/safetyChecks';
import type { ConfirmSafetyRereviewResult, FetchSafetyRereviewsResult, SafetyRereviewQueueItem } from '../api/safetyChecks';
import SafetyRereviewQueue from './SafetyRereviewQueue';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HALL = 'Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)';
const VENUE: SafetyRereviewQueueItem = {
  review_id: 3, arrangement: 'venue', event_id: 12, event_name: 'Open Day', proposed_date: '2030-07-10T02:00:00.000Z',
  coordinator_name: 'Casey Coordinator', flagged_at: '2030-06-01T00:00:00.000Z', label: HALL,
  reason: 'Widen the aisles', decided_by_name: 'Sam Safety', layout: 'theatre',
  placement_venue_name: null, placement_position: null,
};
const MICS: SafetyRereviewQueueItem = {
  ...VENUE, review_id: 4, arrangement: 'equipment', label: '4 × Wireless microphones', layout: null,
  placement_venue_name: 'Regression Hall', placement_position: 'Stage left',
};

const queue = (rereviews: SafetyRereviewQueueItem[], arrangement: 'venue' | 'equipment' = 'venue') =>
  vi.spyOn(api, 'fetchSafetyRereviews').mockResolvedValue({ ok: true, arrangement, rereviews });

const confirmed = (status: string): ConfirmSafetyRereviewResult =>
  ({ ok: true, confirmed: { review_id: 3, event_id: 12, status, outstanding_arrangements: [] } });

describe('SafetyRereviewQueue (SG2-93 AC2/AC4)', () => {
  test('[NORMAL] [SG2-93:AC2] Venue Staff see each flagged booking with the event, reason, who asked, coordinator, date and layout', async () => {
    const fetch = queue([VENUE]);
    render(<SafetyRereviewQueue accessToken="venue-token" />);
    const panel = await screen.findByRole('region', { name: 'Safety changes to confirm' });
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Safety changes to confirm');
    const flag = within(panel).getByRole('article', { name: HALL });
    expect(flag).toHaveTextContent('Open Day');
    expect(flag).toHaveTextContent('Reason: Widen the aisles');
    expect(flag).toHaveTextContent('Asked by Sam Safety');
    expect(flag).toHaveTextContent('Coordinator: Casey Coordinator');
    expect(flag).toHaveTextContent('Event date: 10 Jul 2030, 10:00 SGT');
    expect(flag).toHaveTextContent('Layout: Theatre');
    expect(flag).not.toHaveTextContent('Placed at');
    expect(within(flag).getByRole('button', { name: 'Confirm again' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledWith('venue-token');
  });

  test('[NORMAL] [SG2-93:AC2] Technical Support see where flagged equipment is placed', async () => {
    queue([MICS], 'equipment');
    render(<SafetyRereviewQueue accessToken="support-token" />);
    const flag = await screen.findByRole('article', { name: '4 × Wireless microphones' });
    expect(flag).toHaveTextContent('Placed at Regression Hall — Stage left');
    expect(flag).not.toHaveTextContent('Layout');
  });

  test('[NORMAL] [SG2-93:AC4] confirming the last flag clears it and says the event is back with the Safety Officer', async () => {
    queue([VENUE]);
    const confirm = vi.spyOn(api, 'confirmSafetyRereview').mockResolvedValue(confirmed('awaiting_safety_check'));
    render(<SafetyRereviewQueue accessToken="venue-token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm again' }));
    expect(await screen.findByRole('status'))
      .toHaveTextContent(`Confirmed ${HALL} again for Open Day. The event is back with the Safety Officer.`);
    expect(screen.queryByRole('article', { name: HALL })).toBeNull();
    expect(screen.getByRole('region', { name: 'Safety changes to confirm' })).toBeVisible();
    expect(confirm).toHaveBeenCalledWith(3, 'venue-token');
  });

  test('[BOUNDARY] [SG2-93:AC4] confirming one flag while others remain keeps the event in Planning and the rest listed', async () => {
    queue([VENUE, MICS]);
    vi.spyOn(api, 'confirmSafetyRereview').mockResolvedValue(confirmed('planning'));
    render(<SafetyRereviewQueue accessToken="venue-token" />);
    const flag = await screen.findByRole('article', { name: HALL });
    fireEvent.click(within(flag).getByRole('button', { name: 'Confirm again' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`Confirmed ${HALL} again for Open Day.`);
    expect(screen.getByRole('status')).not.toHaveTextContent('Safety Officer');
    expect(screen.getByRole('article', { name: '4 × Wireless microphones' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  test('[BOUNDARY] [SG2-93:AC2] details never recorded are left out or read plainly', async () => {
    const bare = {
      ...VENUE, event_name: null, reason: null, decided_by_name: null, coordinator_name: null, proposed_date: null,
    };
    queue([
      { ...bare, label: 'No layout', layout: null },
      { ...bare, review_id: 5, label: 'Custom layout', layout: 'cabaret' },
      { ...bare, review_id: 6, arrangement: 'equipment', label: 'Unplaced', layout: null },
      { ...MICS, review_id: 7, label: 'No position', placement_position: null },
    ]);
    render(<SafetyRereviewQueue accessToken="t" />);
    const noLayout = await screen.findByRole('article', { name: 'No layout' });
    expect(noLayout).toHaveTextContent('Untitled event');
    expect(noLayout).toHaveTextContent('Coordinator: Not assigned');
    expect(noLayout).toHaveTextContent('Event date: Date not available');
    expect(noLayout).not.toHaveTextContent('Reason');
    expect(noLayout).not.toHaveTextContent('Asked by');
    expect(noLayout).not.toHaveTextContent('Layout');
    expect(screen.getByRole('article', { name: 'Custom layout' })).toHaveTextContent('Layout: cabaret');
    expect(screen.getByRole('article', { name: 'Unplaced' })).not.toHaveTextContent('Placed at');
    const noPosition = screen.getByRole('article', { name: 'No position' });
    expect(noPosition).toHaveTextContent('Placed at Regression Hall');
    expect(noPosition).not.toHaveTextContent('—');
  });

  test('[BOUNDARY] [SG2-93:AC2] nothing is shown while loading or when nothing is waiting', async () => {
    // The client's ES2020 lib has no Promise.withResolvers, so the executor form holds the resolver.
    let resolve!: (value: FetchSafetyRereviewsResult) => void;
    vi.spyOn(api, 'fetchSafetyRereviews').mockReturnValue(new Promise((done) => { resolve = done; }));
    const { container } = render(<SafetyRereviewQueue accessToken="t" />);
    expect(container).toBeEmptyDOMElement();
    await act(async () => resolve({ ok: true, arrangement: 'venue', rereviews: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  test('[CONFLICT] [SG2-93:AC2] a flag already dealt with stays listed and the refusal is shown in the panel', async () => {
    queue([VENUE]);
    vi.spyOn(api, 'confirmSafetyRereview').mockResolvedValue({
      ok: false, kind: 'conflict', message: 'This booking or equipment request has already been dealt with.' });
    render(<SafetyRereviewQueue accessToken="t" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm again' }));
    const panel = screen.getByRole('region', { name: 'Safety changes to confirm' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('This booking or equipment request has already been dealt with.');
    expect(within(panel).getByRole('article', { name: HALL })).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Confirm again' })).toBeEnabled();
  });

  test('[CONFLICT] [SG2-93:AC4] a second click before the first reply sends one confirmation', async () => {
    queue([VENUE, MICS]);
    let resolve!: (value: ConfirmSafetyRereviewResult) => void;
    const confirm = vi.spyOn(api, 'confirmSafetyRereview').mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SafetyRereviewQueue accessToken="t" />);
    const [first, second] = await screen.findAllByRole('button', { name: 'Confirm again' });
    // Both clicks land in one batch, before React re-renders the buttons disabled.
    act(() => {
      first.click();
      second.click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    await act(async () => resolve(confirmed('planning')));
    expect(screen.getByRole('button', { name: 'Confirm again' })).toBeEnabled();
  });

  test('[FAILURE] [SG2-93:AC2] a list that cannot be read is reported with a retry', async () => {
    const fetch = vi.spyOn(api, 'fetchSafetyRereviews')
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' })
      .mockResolvedValueOnce({ ok: true, arrangement: 'venue', rereviews: [VENUE] });
    render(<SafetyRereviewQueue accessToken="t" />);
    const panel = await screen.findByRole('region', { name: 'Safety changes to confirm' });
    expect(within(panel).getByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('article', { name: HALL })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[FAILURE] [SG2-93:AC2] a list arriving after leaving the screen is ignored', async () => {
    let resolve!: (value: FetchSafetyRereviewsResult) => void;
    vi.spyOn(api, 'fetchSafetyRereviews').mockReturnValue(new Promise((done) => { resolve = done; }));
    const { unmount } = render(<SafetyRereviewQueue accessToken="t" />);
    unmount();
    await act(async () => resolve({ ok: true, arrangement: 'venue', rereviews: [VENUE] }));
    expect(screen.queryByRole('region', { name: 'Safety changes to confirm' })).toBeNull();
  });
});
