vi.hoisted(() => vi.stubEnv('TZ', 'UTC'));
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import VenueHolds from './VenueHolds';
import { changeHold, createHold, fetchHolds, fetchHoldOptions, type VenueHold } from '../venues/holdsApi';

vi.mock('../venues/holdsApi', () => ({ changeHold: vi.fn(), createHold: vi.fn(), fetchHolds: vi.fn(), fetchHoldOptions: vi.fn() }));
const hold: VenueHold = { hold_id: 7, event_id: 41, event_name: 'Partner forum', venue_id: 1, venue_name: 'Atrium Hall',
  starts_at: '2030-06-15T01:00:00.000Z', ends_at: '2030-06-15T09:00:00.000Z', expires_at: '2030-06-14T01:00:00.000Z',
  status: 'tentative', booking_id: null, request_id: 11, created_at: '2030-06-12T01:00:00.000Z' };
const options = { events: [{ event_id: 41, name: 'Partner forum' }], venues: [{ venue_id: 1, name: 'Atrium Hall' }] };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-06-12T01:00:00Z'));
  vi.mocked(fetchHolds).mockResolvedValue({ ok: true, data: [hold] });
  vi.mocked(fetchHoldOptions).mockResolvedValue({ ok: true, data: options });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function open(role: 'Venue Staff' | 'Event Coordinator' = 'Venue Staff') {
  render(<VenueHolds role={role} accessToken="token" />);
  await screen.findByText('Partner forum · Event #41');
}
function fill(expiry = '2030-06-14T01:00', end = '2030-06-15T09:00') {
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: '41' } });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Period starts'), { target: { value: '2030-06-15T01:00' } });
  fireEvent.change(screen.getByLabelText('Period ends'), { target: { value: end } });
  fireEvent.change(screen.getByLabelText('Hold expires'), { target: { value: expiry } });
}

test('[NORMAL] [SG2-84:AC1,AC4,AC6] staff create a persisted tentative hold with an explicit expiry', async () => {
  vi.mocked(fetchHolds).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(createHold).mockResolvedValue({ ok: true, data: hold });
  render(<VenueHolds role="Venue Staff" accessToken="token" />);
  await screen.findByText('No venue holds yet.');
  fill(); fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(await screen.findByText('Partner forum · Event #41')).toBeInTheDocument();
  expect(screen.getByText('Tentative', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Hold placed. The Event Coordinator has been notified of its expiry.');
  expect(createHold).toHaveBeenCalledWith('token', { event_id: 41, venue_id: 1, starts_at: '2030-06-15T01:00:00.000Z', ends_at: '2030-06-15T09:00:00.000Z', expires_at: '2030-06-14T01:00:00.000Z' });
  expect(screen.getByLabelText('Hold expires')).toHaveValue('');
});

test('[FAILURE] [SG2-84:AC1,AC2] missing expiry or selection never dispatches a creation', async () => {
  await open();
  fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Select an event and venue, and enter the period and expiry.');
  fill(''); fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(createHold).not.toHaveBeenCalled();
});

test.each(['2030-06-12T01:00', '2030-06-12T00:59'])('[BOUNDARY] [SG2-84:AC1,AC2] expiry %s is not in the future', async expiry => {
  await open(); fill(expiry); fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(screen.getByRole('alert')).toHaveTextContent('The period must end after it starts, and the expiry must be in the future.');
  expect(createHold).not.toHaveBeenCalled();
});

test('[BOUNDARY] [SG2-84:AC1] an empty-length period is refused and a future expiry one minute after now is accepted', async () => {
  vi.mocked(createHold).mockResolvedValue({ ok: true, data: hold });
  await open(); fill('2030-06-12T01:01', '2030-06-15T01:00');
  fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(createHold).not.toHaveBeenCalled();
  fill('2030-06-12T01:01'); fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  await screen.findByText('Hold placed. The Event Coordinator has been notified of its expiry.');
  expect(createHold).toHaveBeenCalledTimes(1);
});

test('[CONFLICT] [SG2-84:AC3] overlap errors preserve the filled form and existing hold', async () => {
  vi.mocked(createHold).mockResolvedValue({ ok: false, error: 'Conflicts with Tentative hold #7.' });
  await open(); fill(); fireEvent.submit(screen.getByRole('form', { name: 'Place a tentative hold' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Conflicts with Tentative hold #7.');
  expect(screen.getByLabelText('Hold expires')).toHaveValue('2030-06-14T01:00');
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

test('[CONFLICT] [SG2-84:AC1,AC5] rapid repeats issue one placement or approval mutation', async () => {
  let resolveCreate!: (value: any) => void;
  vi.mocked(createHold).mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
  await open(); fill();
  const form = screen.getByRole('form', { name: 'Place a tentative hold' });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(createHold).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Placing hold…' })).toBeDisabled();
  await act(async () => resolveCreate({ ok: true, data: { ...hold, hold_id: 8 } }));
  let resolveChange!: (value: any) => void;
  vi.mocked(changeHold).mockImplementation(() => new Promise(resolve => { resolveChange = resolve; }));
  const approve = screen.getAllByRole('button', { name: 'Approve booking' })[0];
  act(() => { fireEvent.click(approve); fireEvent.click(approve); });
  expect(changeHold).toHaveBeenCalledTimes(1);
  await act(async () => resolveChange({ ok: true, data: { ...hold, status: 'converted', booking_id: 9 } }));
});

test('[NORMAL] [SG2-84:AC5] approval updates only that hold to a confirmed booking and removes its actions', async () => {
  vi.mocked(changeHold).mockResolvedValue({ ok: true, data: { ...hold, status: 'converted', booking_id: 9 } });
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
  expect(await screen.findByText('Confirmed booking', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Booking #9')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
  expect(changeHold).toHaveBeenCalledWith('token', 7, 'convert');
});

test('[NORMAL] [SG2-84:AC5] release frees the period and retains the record', async () => {
  vi.mocked(changeHold).mockResolvedValue({ ok: true, data: { ...hold, status: 'released' } });
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Release hold' }));
  expect(await screen.findByText('Released', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Hold released. The period is available for other requests.');
  expect(changeHold).toHaveBeenCalledWith('token', 7, 'release');
});

test('[FAILURE] [SG2-85:AC3] a failed approval cannot display a confirmed booking', async () => {
  vi.mocked(changeHold).mockResolvedValue({ ok: false, error: 'Hold expired. Create a new request.' });
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hold expired. Create a new request.');
  expect(screen.getByText('Tentative', { exact: true })).toBeInTheDocument();
  expect(screen.queryByText('Confirmed booking', { exact: true })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-84:AC4] coordinators view their assigned holds without staff mutation controls', async () => {
  await open('Event Coordinator');
  expect(fetchHoldOptions).not.toHaveBeenCalled();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
  expect(screen.getByText(/does not count as an approved venue booking/)).toBeInTheDocument();
});

test('[FAILURE] [SG2-84:AC1] other roles cannot view or load the staff workflow', () => {
  render(<VenueHolds role="Attendee" accessToken="token" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Venue holds are available to Venue Staff and Event Coordinators.');
  expect(fetchHolds).not.toHaveBeenCalled();
});

test.each(['holds', 'options'])('[FAILURE] [SG2-84:AC1] %s read failure is retryable without enabling placement', async failing => {
  if (failing === 'holds') vi.mocked(fetchHolds).mockResolvedValueOnce({ ok: false, error: 'Unavailable holds.' });
  else vi.mocked(fetchHoldOptions).mockResolvedValueOnce({ ok: false, error: 'Unavailable options.' });
  render(<VenueHolds role="Venue Staff" accessToken="token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(`Unavailable ${failing}.`);
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Partner forum · Event #41')).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-84:AC1] empty eligible events explains why placement is disabled', async () => {
  vi.mocked(fetchHoldOptions).mockResolvedValue({ ok: true, data: { events: [], venues: [] } });
  await open();
  expect(screen.getByText(/No eligible events or venues/)).toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-85:AC1,AC3] the exact deadline removes approval and requires a new request', async () => {
  vi.mocked(fetchHolds).mockResolvedValue({ ok: true, data: [{ ...hold, expires_at: '2030-06-12T01:00:00.000Z' }] });
  await open();
  expect(screen.getByText('Expired', { exact: true })).toBeInTheDocument();
  expect(screen.getByText(/A new request is needed/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-85:AC1,AC2] the open view refreshes at the next deadline without a real sleep', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-06-12T01:00:00Z'));
  vi.mocked(fetchHolds).mockResolvedValueOnce({ ok: true, data: [{ ...hold, expires_at: '2030-06-12T01:00:01.000Z' }] })
    .mockResolvedValue({ ok: true, data: [{ ...hold, status: 'expired' }] });
  render(<VenueHolds role="Event Coordinator" accessToken="token" />);
  await act(async () => {});
  expect(screen.getByText('Tentative', { exact: true })).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('Expired', { exact: true })).toBeInTheDocument();
  expect(fetchHolds).toHaveBeenCalledTimes(2);
});

test('[CONFLICT] [SG2-84:AC5] deadline refresh waits for an in-flight approval and preserves the saved booking', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-06-12T01:00:00Z'));
  vi.mocked(fetchHolds).mockResolvedValueOnce({ ok: true, data: [{ ...hold, expires_at: '2030-06-12T01:00:01.000Z' }] })
    .mockResolvedValue({ ok: true, data: [{ ...hold, status: 'expired' }] });
  let resolve!: (value: any) => void;
  vi.mocked(changeHold).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<VenueHolds role="Venue Staff" accessToken="token" />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetchHolds).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, data: { ...hold, status: 'converted', booking_id: 19 } }));
  expect(screen.getByText('Confirmed booking', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Booking #19')).toBeInTheDocument();
});

test('[CONFLICT] [SG2-84:AC4] obsolete account responses cannot replace the latest assigned holds', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(fetchHolds).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<VenueHolds role="Event Coordinator" accessToken="old-token" />);
  view.rerender(<VenueHolds role="Event Coordinator" accessToken="new-token" />);
  await screen.findByText('Partner forum · Event #41');
  await act(async () => resolve({ ok: true, data: [{ ...hold, event_name: 'Old account private event' }] }));
  expect(screen.queryByText(/Old account private event/)).not.toBeInTheDocument();
  expect(within(screen.getByRole('article')).getByText('Tentative')).toBeInTheDocument();
});
