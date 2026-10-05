import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import HoldNotifications from './HoldNotifications';
import AppShell from '../screens/AppShell';
import * as api from '../venues/holdNotificationsApi';
import type { HoldNotificationsOutcome } from '../venues/holdNotificationsApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const placed = { notification_id: 1, event_id: 8, hold_id: 3, kind: 'placed' as const, message: 'Atrium is tentatively held for Tech Symposium.', created_at: '2026-10-05T02:00:00.000Z' };
const warning = { ...placed, notification_id: 2, kind: 'warning' as const, message: 'Atrium hold expires in 24 hours.' };
const expired = { ...placed, notification_id: 3, kind: 'expired' as const, message: 'Atrium hold has expired.' };

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
  expect(await screen.findByText('No hold notifications available.')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'ArrowDown' });
  expect(screen.getByRole('complementary')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' }));
  await screen.findByText('No hold notifications available.');
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
  expect(screen.getByRole('status')).toHaveTextContent('Loading hold notifications…');
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

test.each(['Event Organiser', 'Attendee'] as const)('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] %s sees an empty inbox without forbidden API requests or mock alerts', role => {
  const load = vi.spyOn(api, 'loadHoldNotifications');
  render(<AppShell role={role} screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="public-role-token">Dashboard</AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications (0)' }));
  expect(screen.getByText('No notifications available.')).toBeInTheDocument();
  expect(screen.queryByText('Clarification requested on E-201')).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
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
  expect(await screen.findByText('No hold notifications available.')).toBeInTheDocument();
  expect(load).toHaveBeenLastCalledWith('second-token');
});
