import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import NotificationEvent from './NotificationEvent';
import * as api from '../api/notificationInboxApi';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const event = { event_id: 8, name: 'Reminder Forum', status: 'planning', proposed_date: '2030-01-01' };

test('[NORMAL] [SG2-69:AC3] notification event uses recipient-owned identity and renders only minimal summary with reader-facing status', async () => {
  const load = vi.spyOn(api, 'loadNotificationEvent').mockResolvedValue({ ok: true, value: { event } });
  const onView = vi.fn(); render(<NotificationEvent accessToken="token" source="event" notificationId={9} onViewEvent={onView} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading notification event…');
  expect(await screen.findByRole('heading', { name: 'Reminder Forum' })).toBeVisible();
  expect(screen.getByText('E-8')).toBeVisible(); expect(screen.getByText('Arrangements')).toBeVisible(); expect(screen.getByText('1 Jan 2030, 08:00 SGT')).toBeVisible();
  expect(load).toHaveBeenCalledWith('token', 'event', 9);
  fireEvent.click(screen.getByRole('button', { name: 'View event details' })); expect(onView).toHaveBeenCalledWith(8);
});

test('[FAILURE] [SG2-69:AC3] unavailable target gives safe error and retry recovers with absent date', async () => {
  vi.spyOn(api, 'loadNotificationEvent').mockResolvedValueOnce({ ok: false, message: 'Event no longer available.' })
    .mockResolvedValueOnce({ ok: true, value: { event: { ...event, proposed_date: null } } });
  render(<NotificationEvent accessToken="token" source="hold" notificationId={9} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Event no longer available.'); fireEvent.click(screen.getByRole('button', { name: 'Retry event' }));
  expect(await screen.findByText('Date not set')).toBeVisible();
});

test('[CONFLICT] [SG2-69:AC3] session or notification identity changes hide old event and discard its pending request', async () => {
  let done!: (value: Awaited<ReturnType<typeof api.loadNotificationEvent>>) => void;
  vi.spyOn(api, 'loadNotificationEvent').mockImplementationOnce(() => new Promise(resolve => { done = resolve; }))
    .mockResolvedValueOnce({ ok: true, value: { event: { ...event, name: 'Current event' } } });
  const view = render(<NotificationEvent accessToken="first" source="event" notificationId={9} />);
  view.rerender(<NotificationEvent accessToken="second" source="hold" notificationId={10} />);
  expect(await screen.findByRole('heading', { name: 'Current event' })).toBeVisible();
  await act(async () => done({ ok: true, value: { event } })); expect(screen.queryByText('Reminder Forum')).not.toBeInTheDocument();
});
