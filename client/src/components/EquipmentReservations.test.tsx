import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import EquipmentReservations from './EquipmentReservations';
import { EquipmentReservationsError, loadEquipmentReservations, reserveEquipment, type EquipmentReservation, type ReservationsView } from '../api/equipmentReservations';
import { EquipmentAvailabilityError, loadEquipmentAvailability, type AvailabilityReady, type EquipmentAvailability } from '../api/equipmentAvailability';
import type { EquipmentRequirement } from '../api/equipmentRequirements';
vi.mock('../api/equipmentReservations', async original => ({ ...await original<typeof import('../api/equipmentReservations')>(), loadEquipmentReservations: vi.fn(), reserveEquipment: vi.fn() }));
vi.mock('../api/equipmentAvailability', async original => ({ ...await original<typeof import('../api/equipmentAvailability')>(), loadEquipmentAvailability: vi.fn() }));
const record: EquipmentRequirement = { request_id: 11, event_id: 7, equipment_id: 3, equipment_type: 'Microphone', quantity: 4, notes: 'Wireless', status: 'pending', arrangement_notes: null, shortfall: null, placement_venue_id: null, placement_venue_name: null, placement_position: null, version: 2 };
const receipt: EquipmentReservation = { reservation_id: 81, event_id: 7, request_id: 11, equipment_id: 3, equipment_type: 'Microphone', quantity_reserved: 4, starts_at: '2030-06-01T02:00:00Z', ends_at: '2030-06-01T04:00:00Z', reserved_at: '2030-05-31T02:15:16Z' };
const view: ReservationsView = { reservations: [], can_reserve: true };
const saved: ReservationsView = { reservations: [receipt], can_reserve: true, coordinator_notified: true };
const ready: AvailabilityReady = { status: 'ready', event_id: 7, request_id: 11, equipment_id: 3, equipment_type: 'Microphone', quantity_requested: 4, quantity_held: 10, quantity_committed: 4, quantity_remaining: 6, shortfall: 0, undated_commitments: 0, operational_status: 'operational', starts_at: receipt.starts_at!, ends_at: receipt.ends_at!, period_source: 'request', checked_at: receipt.reserved_at! };
const onReserved = vi.fn(); const onRefresh = vi.fn(); const onReceipts = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadEquipmentReservations).mockResolvedValue(view); vi.mocked(loadEquipmentAvailability).mockResolvedValue(ready); vi.mocked(reserveEquipment).mockResolvedValue(saved); });
afterEach(cleanup);
function open(requests = [record]) { return render(<EquipmentReservations eventId={7} accessToken="token" requests={requests} onReserved={onReserved} onRefresh={onRefresh} onReceipts={onReceipts} />); }
async function form() { const result = open(); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' })); await screen.findByText('Available for the suggested period'); return result; }
function dates(start = '2030-06-02T10:00', end = '2030-06-02T12:00') { fireEvent.change(screen.getByLabelText('Reserve from (Singapore time)'), { target: { value: start } }); fireEvent.change(screen.getByLabelText('Reserve until (Singapore time)'), { target: { value: end } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'Reserve equipment: Microphone' })); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('[NORMAL] [SG2-55:AC1] [SG2-55:AC2] [SG2-55:AC4] Technical Support confirms full quantity and Singapore dates, then sees the committed receipt and coordinator notification', async () => {
  open(); expect(screen.getByRole('status')).toHaveTextContent('Loading equipment reservations');
  fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading the suggested reservation period'); await screen.findByText('Available for the suggested period');
  expect(loadEquipmentReservations).toHaveBeenCalledExactlyOnceWith(7, 'token', expect.any(AbortSignal)); expect(loadEquipmentAvailability).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal));
  expect(screen.getByText('Reserve the full request: 4 × Microphone.')).toBeVisible(); expect(screen.getByText(/Stock is checked again when you reserve/)).toBeVisible();
  expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveValue('2030-06-01T10:00'); expect(screen.getByLabelText('Reserve until (Singapore time)')).toHaveValue('2030-06-01T12:00');
  expect(screen.getByText('Available for the suggested period').parentElement).toHaveTextContent('6'); expect(screen.getByText('Calculated shortfall').parentElement).toHaveTextContent('0'); expect(screen.getByText('Availability checked at (Singapore time)').parentElement).toHaveTextContent('31 May 2030, 10:15:16');
  submit(); expect(screen.getByRole('button', { name: 'Reserving…' })).toBeDisabled();
  expect(await screen.findByRole('status')).toHaveTextContent('Equipment reserved for this event. The assigned Event Coordinator has been notified.');
  expect(reserveEquipment).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), { version: 2, starts_at: '2030-06-01T02:00:00.000Z', ends_at: '2030-06-01T04:00:00.000Z' }); expect(onReserved).toHaveBeenCalledExactlyOnceWith(11);
  expect(onReceipts).toHaveBeenLastCalledWith([11]);
  const article = within(screen.getByRole('article', { name: 'Reserved equipment: Microphone' }));
  expect(article.getByText('Quantity reserved').parentElement).toHaveTextContent('4'); expect(article.getByText('Reservation starts (Singapore time)').parentElement).toHaveTextContent('1 Jun 2030, 10:00:00'); expect(article.getByText('Reservation ends (Singapore time)').parentElement).toHaveTextContent('1 Jun 2030, 12:00:00'); expect(article.getByText('Reserved at (Singapore time)').parentElement).toHaveTextContent('31 May 2030, 10:15:16');
  expect(screen.queryByRole('button', { name: 'Reserve Microphone' })).not.toBeInTheDocument(); expect(screen.getByText('No unreserved pending equipment requests are available.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment reservations' })); await screen.findByRole('button', { name: 'Reserve Microphone' }); expect(loadEquipmentReservations).toHaveBeenCalledTimes(2); expect(screen.queryByText(/The assigned Event Coordinator has been notified/)).not.toBeInTheDocument();
});
test('[BOUNDARY] [SG2-55:AC4] a receipt without notification confirmation never claims that a coordinator was notified', async () => {
  vi.mocked(reserveEquipment).mockResolvedValue({ ...saved, coordinator_notified: false }); await form(); submit();
  expect(await screen.findByText('Equipment reserved for this event.')).toBeVisible(); expect(screen.queryByText(/has been notified/)).not.toBeInTheDocument();
});
test('[NORMAL] [SG2-55:AC4] read-only viewers see existing event receipts but no reservation control or availability request', async () => {
  vi.mocked(loadEquipmentReservations).mockResolvedValue({ ...saved, can_reserve: false }); open();
  expect(await screen.findByRole('article', { name: 'Reserved equipment: Microphone' })).toBeVisible(); expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument(); expect(loadEquipmentAvailability).not.toHaveBeenCalled();
  expect(onReceipts).toHaveBeenLastCalledWith([11]);
  expect(screen.getByText(/reduces availability for overlapping events/)).toBeVisible();
});
test('[BOUNDARY] [SG2-55:AC1] [SG2-55:AC4] closed and already reserved requests are excluded while a legacy equipment receipt does not hide a distinct pending request', async () => {
  vi.mocked(loadEquipmentReservations).mockResolvedValue({ ...view, reservations: [{ ...receipt, request_id: null, starts_at: null, ends_at: null, reserved_at: null }, { ...receipt, reservation_id: 82, request_id: 12, starts_at: receipt.starts_at, ends_at: null }] });
  open([record, { ...record, request_id: 12, equipment_type: 'Projector' }, { ...record, request_id: 13, equipment_type: 'Speakers', status: 'approved' }]);
  expect(await screen.findByRole('button', { name: 'Reserve Microphone' })).toBeVisible(); expect(screen.queryByRole('button', { name: 'Reserve Projector' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Reserve Speakers' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('note')).toHaveLength(2); expect(screen.getAllByText('Not recorded')).toHaveLength(4);
  expect(onReceipts).toHaveBeenLastCalledWith([12]);
});
test('[BOUNDARY] [SG2-55:AC1] an event without requests shows the empty state without a reservation action', async () => {
  open([]); expect(await screen.findByText('No equipment reservations recorded.')).toBeVisible(); expect(screen.getByText('No unreserved pending equipment requests are available.')).toBeVisible(); expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument();
});
test.each([new EquipmentReservationsError(403), new Error('Private transport details')])('[FAILURE] [SG2-55:AC4] list failure hides event receipts and retry safely loads current data', async failure => {
  vi.mocked(loadEquipmentReservations).mockRejectedValueOnce(failure); open(); expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentReservationsError ? failure.message : 'Unable to load equipment reservations. Please try again.'); expect(screen.queryByText('Private transport details')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry equipment reservations' })); expect(await screen.findByRole('button', { name: 'Reserve Microphone' })).toBeVisible(); expect(loadEquipmentReservations).toHaveBeenCalledTimes(2);
});
test.each(['2030-06-01T02:00:00Z', null])('[BOUNDARY] [SG2-55:AC1] an incomplete period uses proposed start %s but never invents an end', async proposed_start => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ status: 'dates_required', proposed_start }); open(); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' }));
  expect(await screen.findByRole('note')).toHaveTextContent('No event duration has been assumed'); expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveValue(proposed_start ? '2030-06-01T10:00' : ''); expect(screen.getByLabelText('Reserve until (Singapore time)')).toHaveValue('');
  dates(); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/);
  expect(reserveEquipment).toHaveBeenLastCalledWith(7, 11, 'token', expect.any(AbortSignal), { version: 2, starts_at: '2030-06-02T02:00:00.000Z', ends_at: '2030-06-02T04:00:00.000Z' });
});
test('[BOUNDARY] [SG2-55:AC1] suggested subminute dates retain every second and millisecond in the form and reservation', async () => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, starts_at: '2030-06-01T10:00:45.123+08:00', ends_at: '2030-06-01T10:01:10.456+08:00' });
  await form();
  expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveValue('2030-06-01T10:00:45.123');
  expect(screen.getByLabelText('Reserve until (Singapore time)')).toHaveValue('2030-06-01T10:01:10.456');
  expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveAttribute('step', '0.001');
  expect(screen.getByLabelText('Reserve until (Singapore time)')).toHaveAttribute('step', '0.001');
  expect(screen.queryByRole('note')).not.toBeInTheDocument(); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/);
  expect(reserveEquipment).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), { version: 2, starts_at: '2030-06-01T02:00:45.123Z', ends_at: '2030-06-01T02:01:10.456Z' });
});
test.each([
  ['000001', '000002', '000', '001'],
  ['123000', '123001', '123', '124'],
  ['123456', '124000', '123', '124'],
])('[BOUNDARY] [SG2-55:AC1] finer source interval .%s through .%s expands outward to reviewed millisecond boundaries .%s and .%s', async (sourceStart, sourceEnd, expectedStart, expectedEnd) => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, starts_at: `2030-06-01T02:00:00.${sourceStart}Z`, ends_at: `2030-06-01T02:00:00.${sourceEnd}Z` });
  await form(); expect(screen.getByRole('note')).toHaveTextContent('Suggested dates were expanded to millisecond precision so the full period is covered.');
  submit(); await screen.findByText(/The assigned Event Coordinator has been notified/);
  expect(reserveEquipment).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), { version: 2, starts_at: `2030-06-01T02:00:00.${expectedStart}Z`, ends_at: `2030-06-01T02:00:00.${expectedEnd}Z` });
});
test('[BOUNDARY] [SG2-55:AC1] explicit millisecond dates are transmitted exactly without retaining the old suggested period', async () => {
  await form(); dates('2030-06-02T10:00:30.123', '2030-06-02T10:00:30.124'); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/);
  expect(reserveEquipment).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), { version: 2, starts_at: '2030-06-02T02:00:30.123Z', ends_at: '2030-06-02T02:00:30.124Z' });
});
test.each([new EquipmentAvailabilityError(503), new Error('Private availability failure')])('[FAILURE] [SG2-55:AC1] unavailable advisory still allows explicit dates with the final server stock check', async failure => {
  vi.mocked(loadEquipmentAvailability).mockRejectedValueOnce(failure); open(); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' }));
  expect(await screen.findByRole('note')).toHaveTextContent(failure instanceof EquipmentAvailabilityError ? failure.message : 'Availability could not be loaded. Choose the reservation period; stock will be checked when you reserve.');
  expect(screen.queryByText('Private availability failure')).not.toBeInTheDocument(); dates(); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/); expect(reserveEquipment).toHaveBeenCalledTimes(1);
});
test.each([['', ''], ['2030-06-02T10:00', ''], ['', '2030-06-02T10:00'], ['2030-06-02T10:00', '2030-06-02T10:00'], ['2030-06-02T10:00', '2030-06-01T10:00']])('[FAILURE] [BOUNDARY] [SG2-55:AC1] invalid reservation range %s to %s clears stale advice and refuses dispatch', async (start, end) => {
  await form(); dates(start, end); submit(); expect(screen.getByRole('alert')).toHaveTextContent('Choose both dates, with the end after the start.'); expect(reserveEquipment).not.toHaveBeenCalled(); expect(screen.queryByText('Available for the suggested period')).not.toBeInTheDocument();
  dates(); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('[BOUNDARY] [SG2-55:AC1] non-finite dates cannot be submitted even if a DOM adapter bypasses datetime input sanitization', async () => {
  await form();
  const input = screen.getByLabelText('Reserve from (Singapore time)'); Object.defineProperty(input, 'value', { configurable: true, value: 'invalid' }); fireEvent.change(input); submit(); expect(reserveEquipment).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('end after the start');
});
test.each([new EquipmentReservationsError(409, 'insufficient'), new EquipmentReservationsError(409, 'conflict'), new EquipmentReservationsError(502), new EquipmentReservationsError(503), new EquipmentReservationsError(504), new Error('Private transport failure')])('[CONFLICT] [FAILURE] [SG2-55:AC3] insufficient stock, stale requests and uncertain HTTP or transport results require refresh before another attempt', async failure => {
  vi.mocked(reserveEquipment).mockRejectedValueOnce(failure); await form(); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentReservationsError && failure.status < 500 ? failure.message : 'Unable to confirm the reservation. Refresh reservations and requirements to check whether it was saved before trying again.');
  expect(screen.queryByText('Available for the suggested period')).not.toBeInTheDocument(); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Reserve equipment' })).toBeDisabled(); submit(); expect(reserveEquipment).toHaveBeenCalledTimes(1); expect(onReserved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh reservations and requirements' })); expect(onRefresh).toHaveBeenCalledOnce();
});
test('[FAILURE] [SG2-55:AC1] a correctable period error retains the draft and retry does not reuse stale advisory stock', async () => {
  vi.mocked(reserveEquipment).mockRejectedValueOnce(new EquipmentReservationsError(400)); await form(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid reservation period'); expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveValue('2030-06-01T10:00'); expect(screen.getByRole('button', { name: 'Reserve equipment' })).toBeEnabled();
  dates(); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/); expect(reserveEquipment).toHaveBeenCalledTimes(2);
});
test.each([401, 403, 404])('[FAILURE] [SG2-55:AC1] lost access HTTP %i removes private receipts and the reservation draft', async status => {
  vi.mocked(loadEquipmentReservations).mockResolvedValue({ ...view, reservations: [{ ...receipt, reservation_id: 90, request_id: 90 }] }); vi.mocked(reserveEquipment).mockRejectedValueOnce(new EquipmentReservationsError(status)); await form(); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(new EquipmentReservationsError(status).message); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Retry equipment reservations' })).toBeVisible(); expect(onReserved).not.toHaveBeenCalled();
  expect(onReceipts).toHaveBeenLastCalledWith([]);
});
test('[CONFLICT] [SG2-55:AC1] selected-period lookup and an in-flight reservation reject duplicate submits and disable cancellation', async () => {
  const lookup = deferred<EquipmentAvailability>(); vi.mocked(loadEquipmentAvailability).mockReturnValueOnce(lookup.promise); const saving = deferred<ReservationsView>(); vi.mocked(reserveEquipment).mockReturnValueOnce(saving.promise);
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' })); submit(); expect(reserveEquipment).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Reserve equipment' })).toBeDisabled();
  await act(async () => lookup.resolve(ready)); act(() => { submit(); submit(); }); expect(reserveEquipment).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Cancel reservation' })).toBeDisabled();
  await act(async () => saving.resolve(saved)); expect(screen.getByText(/The assigned Event Coordinator has been notified/)).toBeVisible();
});
test('[NORMAL] [SG2-55:AC1] cancellation discards the draft and opening another pending request clears the previous success message', async () => {
  open([record, { ...record, request_id: 12, equipment_type: 'Projector', equipment_id: 4 }]); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' })); await screen.findByText('Available for the suggested period');
  dates(); fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' })); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(reserveEquipment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Microphone' })); await screen.findByText('Available for the suggested period'); expect(screen.getByLabelText('Reserve from (Singapore time)')).toHaveValue('2030-06-01T10:00'); submit(); await screen.findByText(/The assigned Event Coordinator has been notified/);
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Projector' })); expect(screen.queryByText(/has been notified/)).not.toBeInTheDocument(); await screen.findByText('Available for the suggested period'); expect(loadEquipmentAvailability).toHaveBeenLastCalledWith(7, 12, 'token', expect.any(AbortSignal));
});
test.each(['resolve', 'reject'])('[CONFLICT] [SG2-55:AC4] changing the event aborts a receipt load and ignores its late %s', async outcome => {
  const pending = deferred<ReservationsView>(); vi.mocked(loadEquipmentReservations).mockReturnValueOnce(pending.promise); const rendered = open(); const signal = vi.mocked(loadEquipmentReservations).mock.calls[0][2];
  rendered.rerender(<EquipmentReservations eventId={8} accessToken="token" requests={[]} onReserved={onReserved} onRefresh={onRefresh} onReceipts={onReceipts} />); expect(signal.aborted).toBe(true); await screen.findByText('No equipment reservations recorded.');
  await act(async () => { if (outcome === 'resolve') pending.resolve(saved); else pending.reject(new Error('Private late failure')); }); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(loadEquipmentReservations).toHaveBeenLastCalledWith(8, 'token', expect.any(AbortSignal));
});
test.each(['resolve', 'reject'])('[CONFLICT] [SG2-55:AC1] cancelled availability lookup aborts and cannot populate a later form after %s', async outcome => {
  const pending = deferred<EquipmentAvailability>(); vi.mocked(loadEquipmentAvailability).mockReturnValueOnce(pending.promise); open(); fireEvent.click(await screen.findByRole('button', { name: 'Reserve Microphone' })); const signal = vi.mocked(loadEquipmentAvailability).mock.calls[0][3];
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' })); expect(signal.aborted).toBe(true);
  await act(async () => { if (outcome === 'resolve') pending.resolve(ready); else pending.reject(new Error('Late lookup failure')); }); expect(screen.queryByText('Available for the suggested period')).not.toBeInTheDocument(); expect(screen.queryByRole('note')).not.toBeInTheDocument();
});
test.each(['resolve', 'reject'])('[CONFLICT] [SG2-55:AC1] changed session aborts saving and ignores the late %s without claiming success', async outcome => {
  const pending = deferred<ReservationsView>(); vi.mocked(reserveEquipment).mockReturnValueOnce(pending.promise); const rendered = await form(); submit(); const signal = vi.mocked(reserveEquipment).mock.calls[0][3];
  rendered.rerender(<EquipmentReservations eventId={7} accessToken="replacement-token" requests={[record]} onReserved={onReserved} onRefresh={onRefresh} onReceipts={onReceipts} />); expect(signal.aborted).toBe(true); await screen.findByRole('button', { name: 'Reserve Microphone' });
  await act(async () => { if (outcome === 'resolve') pending.resolve(saved); else pending.reject(new Error('Late save failure')); }); expect(onReserved).not.toHaveBeenCalled(); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByText(/has been notified/)).not.toBeInTheDocument();
});
