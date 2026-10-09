import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import EquipmentAvailability from './EquipmentAvailability';
import { EquipmentAvailabilityError, loadEquipmentAvailability, type AvailabilityReady, type EquipmentAvailability as Availability } from '../api/equipmentAvailability';
vi.mock('../api/equipmentAvailability', async original => ({ ...await original<typeof import('../api/equipmentAvailability')>(), loadEquipmentAvailability: vi.fn() }));
const ready: AvailabilityReady = { status: 'ready', event_id: 7, request_id: 11, equipment_id: 3, equipment_type: 'Microphone', quantity_requested: 8, quantity_held: 10, quantity_committed: 4, quantity_remaining: 6, shortfall: 2, undated_commitments: 0, operational_status: 'operational', starts_at: '2030-06-01T02:00:00Z', ends_at: '2030-06-01T04:00:00Z', period_source: 'request', checked_at: '2030-05-31T02:15:16Z' };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadEquipmentAvailability).mockResolvedValue(ready); });
afterEach(cleanup);
function open() { return render(<EquipmentAvailability eventId={7} requestId={11} equipmentType="Microphone" accessToken="token" />); }
async function check() { const view = open(); fireEvent.click(screen.getByRole('button', { name: 'Check availability for Microphone' })); await screen.findByText('Calculated shortfall'); return view; }
function dates(start = '2030-06-02T10:00', end = '2030-06-02T12:00') { fireEvent.change(screen.getByLabelText('Availability starts (Singapore time)'), { target: { value: start } }); fireEvent.change(screen.getByLabelText('Availability ends (Singapore time)'), { target: { value: end } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'Availability dates for Microphone' })); }
function fact(name: string) { return screen.getByText(name, { exact: true }).parentElement!; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test('[NORMAL] [SG2-54:AC1] [SG2-54:AC3] checks on demand and shows held, peak committed, remaining and shortfall with a precise snapshot period', async () => {
  open(); expect(loadEquipmentAvailability).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Check availability for Microphone' }));
  expect(screen.getByRole('status')).toHaveTextContent('Checking equipment availability'); await screen.findByText('Calculated shortfall');
  expect(loadEquipmentAvailability).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), undefined);
  for (const [name, value] of [['Quantity held', '10'], ['Committed to other events (peak)', '4'], ['Quantity remaining', '6'], ['Quantity requested', '8'], ['Calculated shortfall', '2']]) expect(within(fact(name)).getByText(value, { exact: true })).toBeVisible();
  expect(fact('Period starts (Singapore time)')).toHaveTextContent('1 Jun 2030, 10:00:00'); expect(fact('Period ends (Singapore time)')).toHaveTextContent('1 Jun 2030, 12:00:00');
  expect(fact('Checked at (Singapore time)')).toHaveTextContent('31 May 2030, 10:15:16'); expect(fact('Period source')).toHaveTextContent('Equipment request');
  expect(screen.getByText(/does not reserve equipment or guarantee stock/)).toBeVisible(); expect(screen.queryByRole('note')).not.toBeInTheDocument();
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, quantity_committed: 1, quantity_remaining: 9, shortfall: 0, period_source: 'event_bookings' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh availability' })); await screen.findByText('Confirmed venue bookings'); expect(fact('Quantity remaining')).toHaveTextContent('9'); expect(fact('Calculated shortfall')).toHaveTextContent('0');
});
test.each(['damaged', 'maintenance'] as const)('[FAILURE] [SG2-54:AC2] %s stock displays held count but no remaining stock and full shortfall', async operational_status => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, operational_status, quantity_remaining: 0, shortfall: 8 }); await check();
  expect(fact('Quantity held')).toHaveTextContent('10'); expect(fact('Quantity remaining')).toHaveTextContent('0'); expect(fact('Calculated shortfall')).toHaveTextContent('8'); expect(screen.getByRole('note')).toHaveTextContent('contributes no available stock');
});
test('[BOUNDARY] [SG2-54:AC1] undated commitments are explicitly warned about and large commitment totals are preserved', async () => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, quantity_committed: 4294967294, quantity_remaining: 0, shortfall: 8, undated_commitments: 2 }); await check();
  expect(fact('Committed to other events (peak)')).toHaveTextContent('4294967294'); expect(screen.getByRole('note')).toHaveTextContent('2 reservation(s) have no recorded period');
});
test.each(['2030-06-01T02:00:00Z', null])('[BOUNDARY] [SG2-54:AC1] missing duration asks for complete dates and uses proposed start %s without inventing an end', async proposed_start => {
  vi.mocked(loadEquipmentAvailability).mockResolvedValue({ status: 'dates_required', proposed_start }); open(); fireEvent.click(screen.getByRole('button', { name: 'Check availability for Microphone' }));
  expect(await screen.findByText(/A complete period is needed/)).toBeVisible(); expect(screen.getByLabelText('Availability starts (Singapore time)')).toHaveValue(proposed_start ? '2030-06-01T10:00' : ''); expect(screen.getByLabelText('Availability ends (Singapore time)')).toHaveValue(''); expect(screen.queryByText('Quantity remaining')).not.toBeInTheDocument();
  dates(); vi.mocked(loadEquipmentAvailability).mockResolvedValue({ ...ready, period_source: 'chosen', starts_at: '2030-06-02T02:00:00Z', ends_at: '2030-06-02T04:00:00Z' }); submit();
  await screen.findByText('Selected dates'); expect(loadEquipmentAvailability).toHaveBeenLastCalledWith(7, 11, 'token', expect.any(AbortSignal), { starts_at: '2030-06-02T02:00:00.000Z', ends_at: '2030-06-02T04:00:00.000Z' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh availability' })); await screen.findByText('Selected dates'); expect(loadEquipmentAvailability).toHaveBeenLastCalledWith(7, 11, 'token', expect.any(AbortSignal), { starts_at: '2030-06-02T02:00:00.000Z', ends_at: '2030-06-02T04:00:00.000Z' });
});
test.each([['', ''], ['2030-06-02T10:00', ''], ['2030-06-02T10:00', '2030-06-02T10:00'], ['2030-06-02T10:00', '2030-06-01T10:00']])('[FAILURE] [BOUNDARY] [SG2-54:AC1] invalid range %s to %s removes prior calculation and never dispatches', async (start, end) => {
  await check(); dates(start, end); submit(); expect(screen.getByRole('alert')).toHaveTextContent('end after the start'); expect(screen.queryByText('Quantity remaining')).not.toBeInTheDocument(); expect(loadEquipmentAvailability).toHaveBeenCalledTimes(1);
});
test.each([new EquipmentAvailabilityError(403), new Error('Private failure')])('[FAILURE] [SG2-54:AC1] failed refresh removes the stale calculation and permits retry with a safe message', async failure => {
  await check(); vi.mocked(loadEquipmentAvailability).mockRejectedValueOnce(failure); fireEvent.click(screen.getByRole('button', { name: 'Refresh availability' }));
  expect(screen.queryByText('Quantity remaining')).not.toBeInTheDocument(); expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentAvailabilityError ? failure.message : 'Equipment availability could not be checked. Please try again.'); expect(screen.queryByText('Private failure')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh availability' })); await screen.findByText('Quantity remaining'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('[CONFLICT] [SG2-54:AC1] simultaneous initial checks and selected-date submits share one in-flight request', async () => {
  const pending = deferred<Availability>(); vi.mocked(loadEquipmentAvailability).mockReturnValue(pending.promise); open(); const button = screen.getByRole('button', { name: 'Check availability for Microphone' }); act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(loadEquipmentAvailability).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Refresh availability' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Check selected dates' })).toBeDisabled(); submit(); expect(loadEquipmentAvailability).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(ready)); expect(screen.getByText('Quantity remaining')).toBeVisible();
});
test.each([
  { dimension: 'event', eventId: 8, requestId: 11, accessToken: 'token', outcome: 'resolve' },
  { dimension: 'event', eventId: 8, requestId: 11, accessToken: 'token', outcome: 'reject' },
  { dimension: 'request', eventId: 7, requestId: 12, accessToken: 'token', outcome: 'resolve' },
  { dimension: 'request', eventId: 7, requestId: 12, accessToken: 'token', outcome: 'reject' },
  { dimension: 'session token', eventId: 7, requestId: 11, accessToken: 'next-token', outcome: 'resolve' },
  { dimension: 'session token', eventId: 7, requestId: 11, accessToken: 'next-token', outcome: 'reject' },
])('[CONFLICT] [SG2-54:AC1] changing only $dimension aborts the old request and ignores its late $outcome', async ({ eventId, requestId, accessToken, outcome }) => {
  const pending = deferred<Availability>(); vi.mocked(loadEquipmentAvailability).mockReturnValueOnce(pending.promise); const view = open();
  fireEvent.click(screen.getByRole('button', { name: 'Check availability for Microphone' }));
  expect(loadEquipmentAvailability).toHaveBeenCalledExactlyOnceWith(7, 11, 'token', expect.any(AbortSignal), undefined);
  const signal = vi.mocked(loadEquipmentAvailability).mock.calls[0][3];
  view.rerender(<EquipmentAvailability eventId={eventId} requestId={requestId} equipmentType="Microphone" accessToken={accessToken} />);
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Check availability for Microphone' })).toBeVisible();
  await act(async () => { if (outcome === 'resolve') pending.resolve(ready); else pending.reject(new Error('Late error')); });
  expect(screen.queryByText('Quantity remaining')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check availability for Microphone' }));
  await screen.findByText('Quantity remaining');
  expect(loadEquipmentAvailability).toHaveBeenLastCalledWith(eventId, requestId, accessToken, expect.any(AbortSignal), undefined);
  expect(vi.mocked(loadEquipmentAvailability).mock.calls[1][3]).not.toBe(signal);
  expect(vi.mocked(loadEquipmentAvailability).mock.calls[1][3].aborted).toBe(false);
});
