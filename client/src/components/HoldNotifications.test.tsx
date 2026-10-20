import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HoldNotifications from './HoldNotifications';
import AppShell from '../screens/AppShell';
import * as api from '../venues/holdNotificationsApi';
import type { HoldNotificationsOutcome } from '../venues/holdNotificationsApi';
import * as notices from '../api/notificationsApi';
import type { NotificationsOutcome } from '../api/notificationsApi';

// SG2-49: the drawer also lists venue request decisions; empty unless a test says otherwise.
beforeEach(() => { vi.spyOn(notices, 'loadNotifications').mockResolvedValue({ ok: true, notifications: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const placed = { notification_id: 1, event_id: 8, hold_id: 3, kind: 'placed' as const, message: 'Atrium is tentatively held for Tech Symposium.', created_at: '2026-10-05T02:00:00.000Z' };
const warning = { ...placed, notification_id: 2, kind: 'warning' as const, message: 'Atrium hold expires in 24 hours.' };
const expired = { ...placed, notification_id: 3, kind: 'expired' as const, message: 'Atrium hold has expired.' };
const moved = { ...placed, notification_id: 4, kind: 'expiry_changed' as const, message: 'Tentative hold expiry changed on Atrium.' };

test('[NORMAL] [SG2-55:AC4] the coordinator inbox visibly names the reserved equipment and event', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [] });
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: [{ notification_id: 10,
    event_id: 55, request_id: null, kind: 'equipment_reserved', created_at: '2026-10-11T02:00:00.000Z',
    message: '6 × Wireless microphones reserved for Equipment Reservation Forum.' }] });
  render(<HoldNotifications accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(await screen.findByText('Equipment reserved')).toBeVisible();
  expect(screen.getByText('6 × Wireless microphones reserved for Equipment Reservation Forum.')).toBeVisible();
  expect(screen.getByText('11 Oct 2026, 10:00 SGT')).toBeVisible();
});

test('[NORMAL] [SG2-58:AC1] the organiser inbox shows that their event was confirmed', async () => {
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: [{ notification_id: 11,
    event_id: 7, request_id: null, kind: 'event_confirmed', created_at: '2026-10-11T02:00:00.000Z',
    message: 'Your event Confirmation Forum is confirmed.' }] });
  render(<HoldNotifications accessToken="organiser-token" holds={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(await screen.findByText('Event confirmed')).toBeVisible();
  expect(screen.getByText('Your event Confirmation Forum is confirmed.')).toBeVisible();
  expect(screen.getByText('11 Oct 2026, 10:00 SGT')).toBeVisible();
});

test('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] loads placement, warning and expiry notifications at login and refreshes on reopen', async () => {
  const load = vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [expired, warning, placed] });
  render(<HoldNotifications accessToken="coordinator-token" />);
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Notifications (loading)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText(expired.message)).toBeInTheDocument();
  expect(screen.getByText(warning.message)).toBeInTheDocument();
  expect(screen.getByText(placed.message)).toBeInTheDocument();
  expect(screen.getByText('Tentative hold placed')).toBeInTheDocument();
  expect(screen.getByText('Hold expiring soon')).toBeInTheDocument();
  expect(screen.getByText('Hold expired')).toBeInTheDocument();
  expect(screen.getAllByText('5 Oct 2026, 10:00 SGT')).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Notifications (3)' })).toHaveAttribute('aria-expanded', 'true');
  expect(load).toHaveBeenCalledWith('coordinator-token');

  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (3)' })).toHaveFocus();
  load.mockResolvedValue({ ok: true, notifications: [expired] });
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (3)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeInTheDocument());
  expect(load).toHaveBeenCalledTimes(2);
});

test('[BOUNDARY] [SG2-84:AC6] [SG2-85:AC4] displays an empty real inbox without mock alerts and supports Escape and overlay close', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [] });
  render(<HoldNotifications accessToken="token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'ArrowDown' });
  expect(screen.getByRole('complementary')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' }));
  await screen.findByText('No notifications yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Close notifications overlay' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-84:AC6] [SG2-85:AC4] shows a loading state then a recoverable error and retries the authenticated request', async () => {
  let resolve!: (value: HoldNotificationsOutcome) => void;
  const load = vi.spyOn(api, 'loadHoldNotifications')
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValueOnce({ ok: true, notifications: [warning] });
  render(<HoldNotifications accessToken="token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading notifications…');
  await act(async () => resolve({ ok: false, kind: 'unavailable', message: 'Could not load hold notifications. Please try again.' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load hold notifications. Please try again.');
  expect(screen.getByRole('button', { name: 'Notifications (unavailable)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(warning.message)).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(2);
});

test('[CONFLICT] [SG2-84:AC6] [SG2-85:AC4] overlapping opening, timer and focus refreshes share one request and cleanup ignores stale completion', async () => {
  vi.useFakeTimers();
  let resolve!: (value: HoldNotificationsOutcome) => void;
  const load = vi.spyOn(api, 'loadHoldNotifications').mockImplementation(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(<HoldNotifications accessToken="token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(60_000); window.dispatchEvent(new Event('focus')); });
  expect(load).toHaveBeenCalledTimes(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => resolve({ ok: true, notifications: [placed] }));
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(placed.message)).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] polls the closed badge and updates an open drawer without hiding prior notices', async () => {
  vi.useFakeTimers();
  const load = vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [placed] });
  render(<HoldNotifications accessToken="token" />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Notifications (1)' })).toHaveAttribute('aria-expanded', 'false');
  load.mockResolvedValue({ ok: true, notifications: [placed, warning] });
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole('button', { name: 'Notifications (2)' })).toHaveAttribute('aria-expanded', 'false');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Notifications (2)' })));
  let resolve!: (value: HoldNotificationsOutcome) => void;
  load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByText(placed.message)).toBeInTheDocument();
  expect(screen.getByText(warning.message)).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await act(async () => resolve({ ok: true, notifications: [placed, warning, expired] }));
  expect(screen.getByText(expired.message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (3)' })).toHaveAttribute('aria-expanded', 'true');
  expect(load).toHaveBeenCalledTimes(4);
});

test('[FAILURE] [SG2-84:AC6] [SG2-85:AC4] focus refresh retains known notifications on failure and Retry recovers', async () => {
  const load = vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [placed] });
  render(<HoldNotifications accessToken="token" />);
  await screen.findByRole('button', { name: 'Notifications (1)' });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Notifications (1)' })));
  load.mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'Please try again.' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  expect(screen.getByText(placed.message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeInTheDocument();
  load.mockResolvedValueOnce({ ok: true, notifications: [placed, warning] });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(warning.message)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-84:AC6] [SG2-85:AC4] token changes hide prior data immediately and discard the old request', async () => {
  let resolve!: (value: HoldNotificationsOutcome) => void;
  const load = vi.spyOn(api, 'loadHoldNotifications').mockResolvedValueOnce({ ok: true, notifications: [placed] });
  const { rerender } = render(<HoldNotifications accessToken="first" />);
  await screen.findByRole('button', { name: 'Notifications (1)' });
  load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (1)' }));
  expect(screen.getByText(placed.message)).toBeInTheDocument();
  load.mockResolvedValueOnce({ ok: true, notifications: [] });
  rerender(<HoldNotifications accessToken="second" />);
  expect(screen.queryByText(placed.message)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (loading)' })).toHaveAttribute('aria-expanded', 'false');
  await screen.findByRole('button', { name: 'Notifications (0)' });
  await act(async () => resolve({ ok: true, notifications: [placed, warning] }));
  expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeInTheDocument();
  expect(load).toHaveBeenLastCalledWith('second');
});

test.each(['Event Coordinator', 'Venue Staff', 'Technical Support Staff'] as const)('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] AppShell uses the authenticated recipient inbox for %s', async role => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [warning] });
  render(<AppShell role={role} screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="internal-token">Dashboard</AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText(warning.message)).toBeInTheDocument();
  expect(screen.getByRole('complementary').closest('header')).toBeNull();
  expect(screen.queryByText('No notifications available.')).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] an Attendee sees an empty inbox without forbidden API requests or mock alerts', () => {
  const load = vi.spyOn(api, 'loadHoldNotifications');
  render(<AppShell role="Attendee" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="public-role-token">Dashboard</AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' }));
  expect(screen.getByText('No notifications available.')).toBeInTheDocument();
  expect(screen.queryByText('Clarification requested on E-201')).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
  expect(screen.queryByText('No notifications available.')).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-51:AC4] an Event Organiser is told when a venue for their event is released, without asking for hold notices', async () => {
  const holds = vi.spyOn(api, 'loadHoldNotifications');
  const released = { notification_id: 9, event_id: 7, request_id: null, kind: 'venue_booking_released' as const,
    message: 'Atrium Hall was released for Leadership Summit: Moved online', created_at: '2026-10-07T02:00:00.000Z' };
  vi.spyOn(notices, 'loadNotifications').mockResolvedValue({ ok: true, notifications: [released] });
  render(<AppShell role="Event Organiser" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="organiser-token">Dashboard</AppShell>);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(screen.getByText('Venue booking released')).toBeInTheDocument();
  expect(screen.getByText('Atrium Hall was released for Leadership Summit: Moved online')).toBeInTheDocument();
  expect(screen.queryByText('Clarification requested on E-201')).not.toBeInTheDocument();
  expect(holds).not.toHaveBeenCalled();
});

test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] the Event Coordinator Lead has a real inbox showing a submitted event, its message and time, without asking for hold notices', async () => {
  const holds = vi.spyOn(api, 'loadHoldNotifications');
  const submitted = { notification_id: 30, event_id: 7, request_id: null, kind: 'event_submitted' as const,
    message: 'Partner Forum was submitted and is waiting for a coordinator.', created_at: '2026-10-13T02:00:00.000Z' };
  const load = vi.spyOn(notices, 'loadNotifications').mockResolvedValue({ ok: true, notifications: [submitted] });
  render(<AppShell role="Event Coordinator Lead" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="lead-token">Dashboard</AppShell>);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(screen.getByText('Event submitted')).toBeVisible();
  expect(screen.getByText('Partner Forum was submitted and is waiting for a coordinator.')).toBeVisible();
  expect(screen.getByText('13 Oct 2026, 10:00 SGT')).toBeVisible();
  expect(screen.queryByText('Clarification requested on E-201')).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledWith('lead-token');
  expect(holds).not.toHaveBeenCalled();
});

test('[NORMAL] [SG2-68:AC2] each event lifecycle notice is labelled with what happened', async () => {
  const lifecycle = [
    ['coordinator_assigned', 'You are now coordinating Partner Forum.'],
    ['clarification_requested', 'Your coordinator has a question about Partner Forum.'],
    ['event_approved', 'Partner Forum was approved.'],
    ['event_rejected', 'Partner Forum was not approved: Clashes with the AGM']
  ] as const;
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: lifecycle.map(([kind, message], index) => ({
    notification_id: 40 + index, event_id: 7, request_id: null, kind, message, created_at: '2026-10-13T02:00:00.000Z' })) });
  render(<HoldNotifications accessToken="organiser-token" holds={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (4)' }));
  for (const label of ['Coordinator assigned', 'Question from your coordinator', 'Event approved', 'Event not approved']) {
    expect(screen.getByText(label)).toBeVisible();
  }
  for (const [, message] of lifecycle) expect(screen.getByText(message)).toBeVisible();
  expect(screen.getAllByText('13 Oct 2026, 10:00 SGT')).toHaveLength(4);
});

test('[NORMAL] [SG2-66:AC7] a back-to-Planning notice is labelled and shows its message', async () => {
  const message = 'Partner Forum is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.';
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: [{
    notification_id: 61, event_id: 7, request_id: null, kind: 'event_returned_to_planning', message, created_at: '2026-10-13T02:00:00.000Z' }] });
  render(<HoldNotifications accessToken="coordinator-token" holds={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(screen.getByText('Back in Planning')).toBeVisible();
  expect(screen.getByText(message)).toBeVisible();
});

test('[NORMAL] [SG2-92:AC5] a safety check decision notice is labelled and shows its reason', async () => {
  const message = 'Partner Forum needs changes before it can pass its operational safety check (Venue, Other): Widen the aisles. It has moved back to Planning.';
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: [{
    notification_id: 71, event_id: 7, request_id: null, kind: 'safety_decision', message, created_at: '2026-10-19T03:00:00.000Z' }] });
  render(<HoldNotifications accessToken="organiser-token" holds={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(screen.getByText('Safety check')).toBeVisible();
  expect(screen.getByText(message)).toBeVisible();
});

test('[NORMAL] [SG2-63:AC10] registration opening and closing notices are labelled with what happened', async () => {
  vi.mocked(notices.loadNotifications).mockResolvedValue({ ok: true, notifications: [
    { notification_id: 81, event_id: 7, request_id: null, kind: 'registration_opened',
      message: 'Registration for Partner Forum is now open.', created_at: '2026-10-20T02:00:00.000Z' },
    { notification_id: 82, event_id: 7, request_id: null, kind: 'registration_closed',
      message: 'Registration for Partner Forum has closed.', created_at: '2026-10-21T02:00:00.000Z' },
  ] });
  render(<HoldNotifications accessToken="organiser-token" holds={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2)' }));
  expect(screen.getByText('Registration open')).toBeVisible();
  expect(screen.getByText('Registration closed')).toBeVisible();
  expect(screen.getByText('Registration for Partner Forum has closed.')).toBeVisible();
});

test('[BOUNDARY] [SG2-68:AC3] the Safety Officer, who receives no notices yet, keeps the empty placeholder and makes no notice request', () => {
  render(<AppShell role="Safety Officer" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="safety-token">Dashboard</AppShell>);
  expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeInTheDocument();
  expect(notices.loadNotifications).not.toHaveBeenCalled();
});

test('[BOUNDARY] [SG2-84:AC6] [SG2-85:AC4] a prototype shell without a token preserves sample internal notifications', () => {
  const load = vi.spyOn(api, 'loadHoldNotifications');
  render(<AppShell role="Event Coordinator" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}>Prototype</AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (5)' }));
  expect(screen.getByText('Clarification requested on E-201')).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
});

test('[CONFLICT] [SG2-84:AC6] [SG2-85:AC4] changing the signed-in identity clears the open drawer and its previous count', async () => {
  const load = vi.spyOn(api, 'loadHoldNotifications').mockResolvedValueOnce({ ok: true, notifications: [placed] })
    .mockResolvedValueOnce({ ok: true, notifications: [] });
  const props = { role: 'Event Coordinator' as const, screen: 'dashboard' as const, onNavigate: vi.fn(), onSignOut: vi.fn(), children: 'Dashboard' };
  const { rerender } = render(<AppShell {...props} accessToken="first-token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText(placed.message)).toBeInTheDocument();
  rerender(<AppShell {...props} accessToken="second-token" />);
  expect(screen.queryByText(placed.message)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  expect(load).toHaveBeenLastCalledWith('second-token');
});

const approved = { notification_id: 7, event_id: 8, request_id: 41, kind: 'venue_request_approved' as const,
  message: 'Atrium Hall was approved for Tech Symposium.', created_at: '2026-10-06T02:00:00.000Z' };
const rejected = { ...approved, notification_id: 8, kind: 'venue_request_rejected' as const,
  message: 'Quiet Room was rejected for Tech Symposium: Under repair', created_at: '2026-10-04T02:00:00.000Z' };

test('[NORMAL] [SG2-49:AC1] [SG2-49:AC2] venue request decisions appear in the same drawer as hold notices, newest first', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [placed] });
  const load = vi.spyOn(notices, 'loadNotifications').mockResolvedValue({ ok: true, notifications: [approved, rejected] });
  render(<HoldNotifications accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (3)' }));
  expect(load).toHaveBeenCalledWith('coordinator-token');
  expect(screen.getByText('Venue request approved')).toBeInTheDocument();
  expect(screen.getByText('Venue request rejected')).toBeInTheDocument();
  const messages = screen.getAllByText(/Tech Symposium/).map(node => node.textContent);
  expect(messages).toEqual([approved.message, placed.message, rejected.message]);
});

test('[FAILURE] [SG2-49:AC1] if decision notices cannot load, hold notices still show with a retry, and the count waits for both', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [placed] });
  let resolve!: (value: NotificationsOutcome) => void;
  const load = vi.spyOn(notices, 'loadNotifications')
    .mockResolvedValueOnce({ ok: false, message: 'Could not load notifications. Please try again.' })
    .mockResolvedValueOnce({ ok: false, message: 'Could not load notifications. Please try again.' })
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<HoldNotifications accessToken="token" />);
  // Opening the drawer refreshes both inboxes.
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (unavailable)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notifications. Please try again.');
  expect(screen.getByText(placed.message)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => resolve({ ok: true, notifications: [rejected] }));
  expect(screen.getByText(rejected.message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications (2)' })).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(3);
});

test('[BOUNDARY] [SG2-49:AC1] [SG2-84:AC6] both inboxes failing shows both reasons and no count', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'Could not load hold notifications.' });
  vi.spyOn(notices, 'loadNotifications').mockResolvedValue({ ok: false, message: 'Could not load notifications.' });
  render(<HoldNotifications accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (unavailable)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load hold notifications. Could not load notifications.');
  expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument();
});


test.each(['Event Coordinator', 'Event Organiser'] as const)('[NORMAL] [CONFLICT] [SG2-81:AC1] [SG2-81:AC6] %s sees a real venue disruption warning without losing their existing inbox', async role => {
  vi.mocked(notices.loadNotifications).mockRestore();
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [] });
  const message = 'QA room is unavailable on 14 Nov: maintenance. Find a replacement venue; the event requirements are unchanged.';
  const fetch = vi.fn(async () => Response.json({ notifications: [
    { notification_id: 51, event_id: 20, request_id: null, kind: 'venue_unavailable', message, created_at: '2026-10-16T02:00:00.000Z' },
    { notification_id: 50, event_id: 20, request_id: 14, kind: 'venue_request_approved', message: 'Original booking approved.', created_at: '2026-10-15T02:00:00.000Z' }
  ] }));
  vi.stubGlobal('fetch', fetch);
  try {
    render(<AppShell role={role} screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="recipient-token">Dashboard</AppShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2)' }));
    expect(screen.getByText('Venue unavailable')).toBeVisible();
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByText('Venue request approved')).toBeVisible();
    expect(screen.getByText('Original booking approved.')).toBeVisible();
    expect(screen.getByText('16 Oct 2026, 10:00 SGT')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/notifications', { headers: { Authorization: 'Bearer recipient-token' }, cache: 'no-store' });
    if (role === 'Event Organiser') expect(api.loadHoldNotifications).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

test('[NORMAL] [SG2-84:AC6] a hold expiry stored as a UTC instant is shown in Singapore time', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [{ ...placed,
    message: 'Tentative hold placed on Quiet Room; expiry 2030-06-03T02:00:00.000Z.' }] });
  render(<HoldNotifications accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  expect(await screen.findByText('Tentative hold placed on Quiet Room; expiry 3 Jun 2030, 10:00 SGT.')).toBeVisible();
});

test('[NORMAL] [SG2-106:AC4] an expiry change notice is labelled for the coordinator with its new time', async () => {
  vi.spyOn(api, 'loadHoldNotifications').mockResolvedValue({ ok: true, notifications: [{ ...moved, message: 'Tentative hold expiry changed on Atrium; expiry 2030-06-20T02:00:00Z.' }] });
  render(<HoldNotifications accessToken="coordinator-token" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (loading)' }));
  expect(await screen.findByText('Hold expiry changed')).toBeInTheDocument();
  expect(screen.getByText(/Tentative hold expiry changed on Atrium; expiry 20 Jun 2030, 10:00/)).toBeInTheDocument();
});
