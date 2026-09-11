import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../App';
import { accessFor } from '../../test/access';
import { canOpen, isProtectedScreen, usePageAccess } from './pages';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  sessionStorage.setItem('connectsphere.session', JSON.stringify({ accessToken: 'same-token', user: { userId: 'forged', role: 'Event Coordinator' } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); history.replaceState(null, '', '/'); });
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); };

test('SG2-25: protected deep links wait for verification and ignore a forged cached role', async () => {
  history.replaceState(null, '', '/?screen=form');
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Checking access');
  expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  await act(async () => { finish(Response.json(accessFor('Attendee'))); });
  expect(screen.getByLabelText('Your role')).toHaveTextContent('Attendee');
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(accessFor('Attendee'))));
  await click(screen.getByRole('button', { name: 'Back to dashboard' }));
  expect(screen.getByRole('heading', { name: 'My registrations', level: 1 })).toBeInTheDocument();
});

test('SG2-25: the next action refuses a downgraded role and clears the previous editor', async () => {
  history.replaceState(null, '', '/?screen=form');
  const fetchMock = vi.fn(async () => Response.json(accessFor('Event Organiser')));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('button', { name: 'Save draft' });
  fetchMock.mockImplementation(async () => Response.json(accessFor('Attendee')));
  await click(screen.getByRole('button', { name: 'Save draft' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByText('Draft saved — you can come back to it any time.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
});

test('SG2-25: denied controls stay hidden even on shared read-only pages', async () => {
  history.replaceState(null, '', '/?screen=equipment');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(accessFor('Event Coordinator'))));
  render(<App />);
  await screen.findByRole('heading', { name: 'Equipment requests' });
  expect(screen.queryByRole('button', { name: 'Reserve' })).not.toBeInTheDocument();
  cleanup();
  history.replaceState(null, '', '/?screen=booking');
  render(<App />);
  await screen.findByRole('heading', { name: 'Booking approval' });
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
  cleanup();
  history.replaceState(null, '', '/?screen=change');
  render(<App />);
  await screen.findByRole('heading', { name: /^Change request$/ });
  expect(screen.getByLabelText('New expected attendance')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Send change request' })).not.toBeInTheDocument();
  cleanup();
  history.replaceState(null, '', '/?screen=attendee');
  const readOnly = accessFor('Attendee');
  readOnly.permissions = readOnly.permissions.filter(permission => permission !== 'event_registration.manage');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(readOnly)));
  render(<App />);
  await screen.findByRole('heading', { name: 'Event page' });
  expect(screen.queryByRole('button', { name: 'Withdraw registration' })).not.toBeInTheDocument();
});

test('SG2-25: a late rejected access check cannot replace a newer verified result', async () => {
  let rejectOld!: (reason: Error) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectOld = reject; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  fetchMock.mockImplementation(async () => Response.json(accessFor('Attendee')));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(await screen.findByRole('heading', { name: 'Event page' })).toBeInTheDocument();
  await act(async () => { rejectOld(new Error('Old request aborted')); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Your role')).toHaveTextContent('Attendee');
});

test('SG2-25: focus refresh hides revoked pages and late responses cannot restore a signed-out session', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn(async () => Response.json(accessFor('Venue Staff')));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('banner');
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  const oldResponse = finish;
  expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'Sign out' }));
  await act(async () => { oldResponse(Response.json(accessFor('Venue Staff'))); });
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
  expect(sessionStorage.getItem('connectsphere.session')).toBeNull();
});

test('SG2-25: unknown roles and malformed stored sessions fail closed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ userId: 'user', role: 'constructor', permissions: ['page.dashboard'] })));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to verify access');
  expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  cleanup();
  sessionStorage.setItem('connectsphere.session', '{}');
  history.replaceState(null, '', '/?screen=form');
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(isProtectedScreen('constructor')).toBe(false);
  expect(canOpen(null, 'landing')).toBe(false);
  const expectedError = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(usePageAccess)).toThrow('Protected controls require PageAccess');
  expectedError.mockRestore();
});
