import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HoldNotifications from './HoldNotifications';
import AppShell from '../screens/AppShell';
import * as api from '../api/notificationInboxApi';
import type { InboxNotification, InboxOutcome, InboxPage, ReminderPreferences } from '../api/notificationInboxApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const placed: InboxNotification = { source: 'hold', notification_id: 1, event_id: 8, kind: 'placed', message: 'Atrium is tentatively held for Tech Symposium.', created_at: '2026-10-05T02:00:00.000Z', read_at: null };
const notice = (kind: string, message = kind): InboxNotification => ({ ...placed, source: 'event', kind, message, notification_id: 10 });
const value = (entries: InboxNotification[] = [], count = entries.filter(entry => entry.read_at === null).length,
  next: api.NotificationCursor | null = null): InboxOutcome<InboxPage> => ({ ok: true, value: { notifications: entries, unread_count: count, next_cursor: next } });
const cursor: api.NotificationCursor = { source: 'hold', notification_id: 1, created_at: placed.created_at };
const failure = { ok: false as const, message: 'Please try again.' };
beforeEach(() => {
  vi.spyOn(api, 'loadNotificationInbox').mockResolvedValue(value());
  vi.spyOn(api, 'loadReminderPreferences').mockResolvedValue({ ok: true, value: { frequency_days: 1 } });
  vi.spyOn(api, 'saveReminderPreferences').mockResolvedValue({ ok: true, value: { frequency_days: 3 } });
  vi.spyOn(api, 'readNotification').mockImplementation(async (_token, source, id) => ({ ok: true,
    value: { notification: { ...placed, source, notification_id: id, read_at: placed.created_at }, unread_count: 0 } }));
  vi.spyOn(api, 'readAllNotifications').mockResolvedValue({ ok: true, value: { unread_count: 0 } });
});
async function open(count = 1) { fireEvent.click(await screen.findByRole('button', { name: `Notifications (${count})` })); }
function clickBatch(...buttons: HTMLElement[]) { act(() => { for (const button of buttons) button.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }

test('[NORMAL] [SG2-69:AC1] [SG2-69:AC2] [SG2-55:AC4] [SG2-58:AC1] [SG2-51:AC4] [SG2-49:AC1] [SG2-49:AC2] [SG2-81:AC1] [SG2-79:AC4] [SG2-68:AC1] [SG2-68:AC2] [SG2-66:AC7] [SG2-92:AC5] [SG2-63:AC10] [SG2-60:AC1] [SG2-62:AC5] [SG2-69:AC5] [SG2-84:AC6] [SG2-85:AC4] [SG2-106:AC4] [SG2-65:AC1] [SG2-65:AC2] [SG2-102:AC2] [SG2-61:AC3] [SG2-62:AC6] badge counts all unread and rows visibly distinguish read state', async () => {
  const expectedLabels = [
    ['equipment_reserved', 'Equipment reserved'],
    ['event_confirmed', 'Event confirmed'],
    ['venue_booking_released', 'Venue booking released'],
    ['venue_request_approved', 'Venue request approved'],
    ['venue_request_rejected', 'Venue request rejected'],
    ['venue_unavailable', 'Venue unavailable'],
    ['venue_booking_clash', 'Booking clash flagged'],
    ['event_submitted', 'Event submitted'],
    ['coordinator_assigned', 'Coordinator assigned'],
    ['clarification_requested', 'Question from your coordinator'],
    ['event_approved', 'Event approved'],
    ['event_rejected', 'Event not approved'],
    ['event_returned_to_planning', 'Back in Planning'],
    ['safety_decision', 'Safety check'],
    ['registration_opened', 'Registration open'],
    ['registration_closed', 'Registration closed'],
    ['registration_confirmed', 'Registration confirmed'],
    ['registration_withdrawn', 'Attendee withdrew'],
    ['outstanding_arrangements', 'Outstanding arrangements'],
    ['placed', 'Tentative hold placed'],
    ['warning', 'Hold expiring soon'],
    ['expired', 'Hold expired'],
    ['expiry_changed', 'Hold expiry changed'],
    ['venue_booking_cancelled', 'Venue booking cancelled'],
    ['venue_change_requested', 'Venue change requested'],
    ['cancellation_requested', 'Cancellation requested'],
    ['event_cancelled', 'Event cancelled'],
    ['change_requested', 'Change requested'],
    ['change_accepted', 'Change accepted'],
    ['change_refused', 'Change refused'],
    ['event_changed', 'Event changed'],
    ['registration_full', 'Event full'],
    ['waiting_list_offer', 'Place offered'],
    ['waiting_list_offer_lapsed', 'Offer lapsed'],
  ] as const;
  const notifications: InboxNotification[] = expectedLabels.map(([kind], index) => ({
    ...notice(kind, kind === 'placed' ? placed.message : kind === 'event_confirmed' ? kind : `Message for ${kind}.`),
    source: ['placed', 'warning', 'expired', 'expiry_changed'].includes(kind) ? 'hold' : 'event',
    notification_id: index + 1,
    read_at: kind === 'event_confirmed' ? placed.created_at : null,
  }));
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value(notifications, 80));
  render(<HoldNotifications accessToken="token" />); await open(80);
  expect(screen.getByText('80 unread')).toBeVisible();
  for (const [index, [, label]] of expectedLabels.entries()) {
    const notification = notifications[index];
    const row = screen.getByRole('button', { name: `${notification.read_at ? 'Read' : 'Unread'}: ${notification.message}` });
    expect(row).toBeVisible();
    expect(within(row).getByText(label)).toBeVisible();
    expect(within(row).getByText(notification.message)).toBeVisible();
    expect(within(row).getByText(/5 Oct 2026, 10:00 SGT/)).toBeVisible();
  }
  expect(api.loadNotificationInbox).toHaveBeenCalledWith('token');
  expect(api.loadReminderPreferences).not.toHaveBeenCalled();
});

test.each([99, 100, 1000])('[BOUNDARY] [SG2-69:AC1] [SG2-69:AC2] badge stays compact while its accessible name and inbox retain the exact total at %s unread', async count => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], count));
  render(<HoldNotifications accessToken="token" />);
  const trigger = await screen.findByRole('button', { name: `Notifications (${count})` });
  expect(within(trigger).getByText(count === 99 ? '99' : '99+', { exact: true })).toBeVisible();
  fireEvent.click(trigger);
  expect(within(screen.getByRole('complementary', { name: 'Notifications' })).getByText(`${count} unread`, { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: `Unread: ${placed.message}` })).toBeVisible();
});

test('[NORMAL] [SG2-69:AC2] [SG2-84:AC6] raw UTC hold expiry is shown in Singapore time', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([{ ...placed, message: 'Hold expiry 2030-06-03T02:00:00.000Z.' }]));
  render(<HoldNotifications accessToken="token" />); await open();
  expect(screen.getByText('Hold expiry 3 Jun 2030, 10:00 SGT.')).toBeVisible();
});

test('[NORMAL] [SG2-69:AC3] opening own notification persists read state then navigates using its identity', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed, notice('event_submitted')])); const navigate = vi.fn();
  render(<HoldNotifications accessToken="token" onOpenNotification={navigate} />); await open(2);
  fireEvent.click(screen.getByRole('button', { name: `Unread: ${placed.message}` }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('hold', 1));
  expect(api.readNotification).toHaveBeenCalledWith('token', 'hold', 1);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (0)' })).toHaveFocus();
});

test.each([false, true])('[BOUNDARY] [SG2-69:AC3] notice with no target callback or no linked event remains readable (%s)', async noEvent => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed]));
  vi.mocked(api.readNotification).mockResolvedValue({ ok: true, value: { notification: { ...placed, event_id: noEvent ? null : 8, read_at: placed.created_at }, unread_count: 0 } });
  const navigate = vi.fn(); render(<HoldNotifications accessToken="token" onOpenNotification={noEvent ? navigate : undefined} />); await open();
  fireEvent.click(screen.getByRole('button', { name: `Unread: ${placed.message}` }));
  expect(await screen.findByRole('button', { name: `Read: ${placed.message}` })).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-69:AC3] [SG2-69:AC4] failed read actions preserve unread rows and count', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed])); vi.mocked(api.readNotification).mockResolvedValue(failure);
  vi.mocked(api.readAllNotifications).mockResolvedValue(failure);
  render(<HoldNotifications accessToken="token" />); await open();
  fireEvent.click(screen.getByRole('button', { name: `Unread: ${placed.message}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
  await waitFor(() => expect(api.readAllNotifications).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: `Unread: ${placed.message}` })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeVisible();
});

test('[NORMAL] [SG2-69:AC4] mark-all clears every unread state and preserves existing read entries', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed, { ...notice('event_confirmed'), read_at: placed.created_at }], 80));
  render(<HoldNotifications accessToken="token" />); await open(80); fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
  expect(await screen.findByRole('button', { name: `Read: ${placed.message}` })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Read: event_confirmed' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeVisible();
});

test('[BOUNDARY] [SG2-69:AC1] empty drawer supports Escape, overlay, toggle and focus return', async () => {
  render(<HoldNotifications accessToken="token" />); await open(0);
  expect(screen.getByText('No notifications yet.')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'ArrowDown' }); expect(screen.getByRole('complementary')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' }); expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  await open(0); fireEvent.click(screen.getByRole('button', { name: 'Close notifications overlay' }));
  await open(0); fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' })); expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-69:AC1] initial load failure shows unavailable badge and retry recovers', async () => {
  let resolve!: (result: InboxOutcome<InboxPage>) => void;
  vi.mocked(api.loadNotificationInbox).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(value([placed]));
  render(<HoldNotifications accessToken="token" />); fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading notifications…');
  await act(async () => resolve(failure)); expect(screen.getByRole('button', { name: 'Notifications (unavailable)' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(await screen.findByText(placed.message)).toBeVisible();
});

test('[CONFLICT] [SG2-69:AC1] overlapping open, focus and polling loads deduplicate and unmount clears polling', async () => {
  vi.useFakeTimers(); let resolve!: (result: InboxOutcome<InboxPage>) => void;
  vi.mocked(api.loadNotificationInbox).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<HoldNotifications accessToken="token" />); fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  act(() => { vi.advanceTimersByTime(60_000); window.dispatchEvent(new Event('focus')); });
  expect(api.loadNotificationInbox).toHaveBeenCalledTimes(1); view.unmount();
  expect(vi.getTimerCount()).toBe(0); await act(async () => resolve(value([placed])));
});

test('[NORMAL] [SG2-69:AC1] periodic and focus refresh preserve last good state on errors', async () => {
  vi.useFakeTimers(); vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed])); render(<HoldNotifications accessToken="token" />);
  await act(async () => {}); fireEvent.click(screen.getByRole('button', { name: 'Notifications (1)' })); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(failure); await act(async () => window.dispatchEvent(new Event('focus')));
  expect(screen.getByText(placed.message)).toBeVisible(); expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 20)); await act(async () => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole('button', { name: 'Notifications (20)' })).toBeVisible(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-69:AC1] [SG2-69:AC3] [SG2-69:AC4] token changes discard open previous data and ignore its pending refresh', async () => {
  let resolve!: (result: InboxOutcome<InboxPage>) => void;
  let readDone!: (result: Awaited<ReturnType<typeof api.readNotification>>) => void;
  const navigate = vi.fn();
  vi.mocked(api.readNotification).mockImplementationOnce(() => new Promise(done => { readDone = done; }));
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([placed])).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(value());
  const view = render(<HoldNotifications accessToken="first" onOpenNotification={navigate} />); await open(); expect(screen.getByText(placed.message)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: `Unread: ${placed.message}` }));
  expect(api.readNotification).toHaveBeenCalledWith('first', 'hold', placed.notification_id);
  view.rerender(<HoldNotifications accessToken="second" onOpenNotification={navigate} />); expect(screen.queryByText(placed.message)).not.toBeInTheDocument();
  await act(async () => resolve(value([placed]))); expect(await screen.findByRole('button', { name: 'Notifications (0)' })).toBeVisible();
  expect(api.loadNotificationInbox).toHaveBeenLastCalledWith('second');
  await act(async () => readDone({ ok: true, value: { notification: { ...placed, read_at: placed.created_at }, unread_count: 0 } }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeVisible();
});

test('[CONFLICT] [SG2-69:AC3] a pending poll cannot undo a successful read and rapid actions issue one mutation', async () => {
  let poll!: (result: InboxOutcome<InboxPage>) => void; let done!: (result: Awaited<ReturnType<typeof api.readNotification>>) => void;
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([placed])).mockImplementationOnce(() => new Promise(resolve => { poll = resolve; }));
  vi.mocked(api.readNotification).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  render(<HoldNotifications accessToken="token" />); await open();
  const row = screen.getByRole('button', { name: `Unread: ${placed.message}` }); const all = screen.getByRole('button', { name: 'Mark all as read' });
  clickBatch(row, row, all); expect(api.readNotification).toHaveBeenCalledTimes(1); expect(api.readAllNotifications).not.toHaveBeenCalled();
  await act(async () => done({ ok: true, value: { notification: { ...placed, read_at: placed.created_at }, unread_count: 0 } }));
  await act(async () => poll(value([placed], 1))); expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeVisible();
  expect(screen.getByRole('button', { name: `Read: ${placed.message}` })).toBeVisible();
});

test('[BOUNDARY] [SG2-69:AC2] older pages retain exact database order across microseconds and deduplicate identities', async () => {
  const newer = { ...notice('event_submitted', 'Newer event'), created_at: '2026-10-05T02:00:00.123900Z' };
  const old = { ...placed, message: 'Older hold', created_at: '2026-10-05T02:00:00.123100Z' };
  const tied = { ...notice('event_confirmed', 'Tied event'), notification_id: 9, created_at: old.created_at };
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([newer], 53, cursor)).mockResolvedValueOnce(value([newer], 53, cursor))
    .mockResolvedValueOnce(value([old, tied, newer], 53));
  render(<HoldNotifications accessToken="token" />); await open(53); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' })); await screen.findByText('Older hold');
  expect(api.loadNotificationInbox).toHaveBeenLastCalledWith('token', cursor);
  expect(within(screen.getByRole('complementary')).getAllByRole('button', { name: /^Unread:/ }).map(button => button.getAttribute('aria-label')))
    .toEqual(['Unread: Newer event', 'Unread: Older hold', 'Unread: Tied event']);
  expect(screen.queryByRole('button', { name: 'Load older notifications' })).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-69:AC2] older page error keeps current list and allows retry', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 53, cursor)); render(<HoldNotifications accessToken="token" />); await open(53); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(failure); fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.'); expect(screen.getByText(placed.message)).toBeVisible();
});



test('[CONFLICT] [SG2-69:AC2] in-flight older page blocks duplicate read, markall, page and focus loads', async () => {
  let done!: (result: InboxOutcome<InboxPage>) => void;
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 53, cursor)); render(<HoldNotifications accessToken="token" />); await open(53); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const older = screen.getByRole('button', { name: 'Load older notifications' }); const row = screen.getByRole('button', { name: `Unread: ${placed.message}` });
  clickBatch(older, older, row, screen.getByRole('button', { name: 'Mark all as read' }));
  act(() => window.dispatchEvent(new Event('focus'))); expect(api.loadNotificationInbox).toHaveBeenCalledTimes(3);
  expect(api.readNotification).not.toHaveBeenCalled(); expect(api.readAllNotifications).not.toHaveBeenCalled();
  await act(async () => done(value()));
});

test('[CONFLICT] [SG2-69:AC4] pending mark-all prevents duplicate all/older actions and polling', async () => {
  let done!: (value: Awaited<ReturnType<typeof api.readAllNotifications>>) => void;
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 53, cursor)); render(<HoldNotifications accessToken="token" />); await open(53); await act(async () => {});
  vi.mocked(api.readAllNotifications).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const all = screen.getByRole('button', { name: 'Mark all as read' }); clickBatch(all, all, screen.getByRole('button', { name: 'Load older notifications' }));
  act(() => window.dispatchEvent(new Event('focus'))); expect(api.readAllNotifications).toHaveBeenCalledTimes(1); expect(api.loadNotificationInbox).toHaveBeenCalledTimes(2);
  await act(async () => done({ ok: true, value: { unread_count: 1 } })); expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeVisible();
});

test('[NORMAL] [SG2-69:AC6] coordinator gets daily default, can save frequency, and sees confirmation', async () => {
  render(<HoldNotifications accessToken="token" coordinator />); await open(0);
  const input = await screen.findByRole('spinbutton', { name: 'Reminder frequency (days)' }); await waitFor(() => expect(input).toBeEnabled()); expect(input).toHaveValue(1);
  fireEvent.change(input, { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save reminder frequency' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Reminder frequency saved.'); expect(api.saveReminderPreferences).toHaveBeenCalledWith('token', 3);
});

test.each(['', '0', '31', '1.5'])('[BOUNDARY] [SG2-69:AC6] invalid frequency %s cannot submit', async days => {
  render(<HoldNotifications accessToken="token" coordinator />); await open(0); const input = await screen.findByRole('spinbutton'); await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: days } }); expect(screen.getByRole('button', { name: 'Save reminder frequency' })).toBeDisabled();
  fireEvent.submit(input.closest('form')!); expect(api.saveReminderPreferences).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-69:AC6] preference read retry and failed save show safe errors', async () => {
  vi.mocked(api.loadReminderPreferences).mockResolvedValueOnce(failure).mockResolvedValueOnce({ ok: true, value: { frequency_days: 30 } });
  vi.mocked(api.saveReminderPreferences).mockResolvedValue(failure);
  render(<HoldNotifications accessToken="token" coordinator />); await open(0);
  fireEvent.submit(screen.getByRole('spinbutton').closest('form')!); expect(api.saveReminderPreferences).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry reminder preferences' })); await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(30));
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder frequency' })); expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
});

test.each(['load', 'save'] as const)('[CONFLICT] [SG2-69:AC6] closing drawer ignores stale preference %s', async operation => {
  let done!: (result: InboxOutcome<ReminderPreferences>) => void;
  if (operation === 'load') vi.mocked(api.loadReminderPreferences).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  render(<HoldNotifications accessToken="token" coordinator />); await open(0);
  if (operation === 'save') {
    const input = await screen.findByRole('spinbutton'); await waitFor(() => expect(input).toBeEnabled());
    vi.mocked(api.saveReminderPreferences).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    fireEvent.submit(input.closest('form')!); fireEvent.submit(input.closest('form')!); expect(api.saveReminderPreferences).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' })); await act(async () => done({ ok: true, value: { frequency_days: 7 } }));
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});

test.each(['Event Coordinator', 'Venue Staff', 'Technical Support Staff', 'Event Organiser', 'Event Coordinator Lead', 'Safety Officer', 'Attendee'] as const)(
  '[NORMAL] [SG2-69:AC1] [SG2-68:AC3] AppShell uses authenticated own inbox for %s', async role => {
    vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed]));
    render(<AppShell role={role} screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="token">Dashboard</AppShell>); await open();
    expect(screen.getByText(placed.message)).toBeVisible(); expect(screen.getByRole('complementary').closest('header')).toBeNull();
    expect(screen.queryByText('Clarification requested on E-201')).not.toBeInTheDocument();
    expect(api.loadReminderPreferences).toHaveBeenCalledTimes(role === 'Event Coordinator' ? 1 : 0);
  });

test('[BOUNDARY] [SG2-69:AC1] a tokenless attendee shell retains the empty preview drawer', () => {
  render(<AppShell role="Attendee" screen="findEvents" onNavigate={vi.fn()} onSignOut={vi.fn()}>Catalogue</AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' })); expect(screen.getByText('No notifications available.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' })); expect(screen.queryByText('No notifications available.')).not.toBeInTheDocument();
});

test.each(['Event Coordinator', 'Event Organiser'] as const)('[CONFLICT] [SG2-81:AC1] [SG2-81:AC6] %s keeps a disruption warning alongside its original approval', async role => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([
    { ...notice('venue_unavailable', 'QA room is unavailable: maintenance. Find a replacement venue.'), notification_id: 12 },
    notice('venue_request_approved', 'Original booking approved.')
  ]));
  render(<AppShell accessToken="token" role={role} screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}>Dashboard</AppShell>); await open(2);
  expect(screen.getByText('Venue unavailable')).toBeVisible(); expect(screen.getByText('Original booking approved.')).toBeVisible();
  expect(screen.getByText('QA room is unavailable: maintenance. Find a replacement venue.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-69:AC1] [SG2-69:AC2] refresh reconciles opened page depth, remote read state and a new first-page arrival atomically', async () => {
  const olderNotice = { ...notice('event_submitted', 'Older notification'), notification_id: 9, created_at: '2026-10-01T02:00:00Z' };
  const arrival = { ...notice('outstanding_arrangements', 'New reminder'), notification_id: 11, created_at: '2026-10-21T02:00:00Z' };
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 2, cursor)); render(<HoldNotifications accessToken="token" />); await open(2); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([olderNotice], 2));
  fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' })); expect(await screen.findByText('Older notification')).toBeVisible();
  let secondPage!: (value: InboxOutcome<InboxPage>) => void;
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([arrival], 1, cursor))
    .mockImplementationOnce(() => new Promise(resolve => { secondPage = resolve; }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(screen.queryByText('New reminder')).not.toBeInTheDocument(); expect(screen.getByText('Older notification')).toBeVisible();
  await act(async () => secondPage(value([{ ...placed, read_at: placed.created_at }, { ...olderNotice, read_at: placed.created_at }], 1)));
  expect(screen.getByText('New reminder')).toBeVisible(); expect(screen.getByRole('button', { name: 'Read: Older notification' })).toBeVisible();
  expect(screen.getByRole('button', { name: `Read: ${placed.message}` })).toBeVisible(); expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeVisible();
});

test('[FAILURE] [SG2-69:AC2] failed later-page refresh retains the complete last good list and global count', async () => {
  const olderNotice = { ...notice('event_submitted', 'Older notification'), notification_id: 9 };
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 2, cursor)); render(<HoldNotifications accessToken="token" />); await open(2); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([olderNotice], 2)); fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
  await screen.findByText('Older notification');
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([], 0, cursor)).mockResolvedValueOnce(failure);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again.'); expect(screen.getByText('Older notification')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Notifications (2)' })).toBeVisible();
});

test('[BOUNDARY] [SG2-69:AC2] a refreshed shorter history has no further continuation and settles on its actual depth', async () => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 1, cursor)); render(<HoldNotifications accessToken="token" />); await open(); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([notice('event_submitted')], 1)); fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
  await screen.findByText('event_submitted'); vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value());
  await act(async () => window.dispatchEvent(new Event('focus'))); expect(screen.getByText('No notifications yet.')).toBeVisible();
});

test.each(['unmount', 'mutation'] as const)('[CONFLICT] [SG2-69:AC2] %s stops a stale multi-page refresh before fetching another page', async change => {
  vi.mocked(api.loadNotificationInbox).mockResolvedValue(value([placed], 1, cursor)); const view = render(<HoldNotifications accessToken="token" />); await open(); await act(async () => {});
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([notice('event_submitted')], 1)); fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
  await screen.findByText('event_submitted'); let pending!: (result: InboxOutcome<InboxPage>) => void;
  vi.mocked(api.loadNotificationInbox).mockImplementationOnce(() => new Promise(resolve => { pending = resolve; }));
  act(() => window.dispatchEvent(new Event('focus')));
  if (change === 'unmount') view.unmount();
  else { fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' })); await act(async () => {}); }
  await act(async () => pending(value([placed], 1, cursor)));
  expect(api.loadNotificationInbox).toHaveBeenCalledTimes(4);
});

test('[CONFLICT] [SG2-69:AC1] [SG2-69:AC6] [SG2-104:AC1] changing acting role with the same token discards pending inbox and coordinator preferences', async () => {
  let inbox!: (result: InboxOutcome<InboxPage>) => void;
  let preferences!: (result: InboxOutcome<ReminderPreferences>) => void;
  vi.mocked(api.loadNotificationInbox).mockResolvedValueOnce(value([placed]))
    .mockImplementationOnce(() => new Promise(resolve => { inbox = resolve; })).mockResolvedValue(value());
  vi.mocked(api.loadReminderPreferences).mockImplementationOnce(() => new Promise(resolve => { preferences = resolve; }));
  const view = render(<AppShell role="Event Coordinator" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="token">Desk</AppShell>);
  await open();
  expect(screen.getByText(placed.message)).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: 'Reminder frequency (days)' })).toBeDisabled();

  view.rerender(<AppShell role="Venue Staff" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="token">Desk</AppShell>);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  await act(async () => {
    inbox(value([placed], 42));
    preferences({ ok: true, value: { frequency_days: 7 } });
  });
  await open(0);
  expect(screen.queryByText(placed.message)).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(api.loadReminderPreferences).toHaveBeenCalledTimes(1);
  expect(api.loadNotificationInbox).toHaveBeenCalledTimes(4);
});
