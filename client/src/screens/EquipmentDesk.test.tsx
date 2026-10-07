import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import EquipmentDesk from './EquipmentDesk';
import { loadAccess, type Access } from '../auth/access';
import { EquipmentError, listEquipment, saveEquipment, type EquipmentRecord, type EquipmentValues } from '../api/equipment';

vi.mock('../auth/access', async importOriginal => ({ ...await importOriginal<typeof import('../auth/access')>(), loadAccess: vi.fn() }));
vi.mock('../api/equipment', async importOriginal => ({ ...await importOriginal<typeof import('../api/equipment')>(), listEquipment: vi.fn(), saveEquipment: vi.fn() }));
const staff: Access = { userId: 'staff-1', role: 'Technical Support Staff', permissions: ['equipment.read', 'equipment.create', 'equipment.update'] };
const values: EquipmentValues = { type: 'Microphone', description: 'Wireless handheld', quantity_held: 8, location: 'Store A', operational_status: 'operational' };
const record: EquipmentRecord = { ...values, equipment_id: 7, available_quantity: 8, version: 2 };
const other: EquipmentRecord = { ...record, equipment_id: 8, type: 'Projector', location: 'Store B', quantity_held: 4, operational_status: 'damaged', available_quantity: 0 };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadAccess).mockResolvedValue(staff); vi.mocked(listEquipment).mockResolvedValue([record, other]); vi.mocked(saveEquipment).mockResolvedValue(record); });
afterEach(cleanup);
async function open() {
  const view = render(<EquipmentDesk accessToken="token" />);
  await screen.findByRole('region', { name: 'Equipment records' });
  return view;
}
function fill(type = 'Speaker') {
  fireEvent.change(screen.getByLabelText('Equipment type'), { target: { value: type } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Portable audio' } });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Store C' } });
  fireEvent.change(screen.getByLabelText('Quantity held'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Operational status'), { target: { value: 'maintenance' } });
}
function submit(name = 'Add equipment') { fireEvent.submit(screen.getByRole('form', { name })); }
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('[FAILURE] [SG2-52:AC3] signed-out users cannot load or edit equipment', () => {
  render(<EquipmentDesk />);
  expect(screen.getByText('Sign in to view equipment records.')).toBeInTheDocument();
  expect(loadAccess).not.toHaveBeenCalled(); expect(listEquipment).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Add equipment' })).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-52:AC1,AC2] persisted records expose all fields and exclude non-operational stock from availability', async () => {
  vi.mocked(listEquipment).mockResolvedValue([record, other, { ...other, equipment_id: 9, type: 'Mixer', operational_status: 'maintenance' }]);
  render(<EquipmentDesk accessToken="token" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading equipment records…');
  await screen.findByRole('region', { name: 'Equipment records' });
  expect(loadAccess).toHaveBeenCalledWith('token', expect.any(AbortSignal));
  expect(listEquipment).toHaveBeenCalledWith('token', expect.any(AbortSignal));
  expect(screen.getByText(/3 equipment records/)).toBeInTheDocument();
  const microphone = within(screen.getByRole('article', { name: 'Microphone' }));
  for (const text of ['Description', 'Wireless handheld', 'Location', 'Store A', 'Quantity held', 'Operational status', 'Operational', 'Available quantity']) expect(microphone.getByText(text)).toBeInTheDocument();
  expect(microphone.getAllByText('8')).toHaveLength(2);
  expect(within(screen.getByRole('article', { name: 'Projector' })).getByText('Damaged')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Projector' })).getByText('0')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Mixer' })).getByText('Under maintenance')).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-52:AC1] an empty catalogue creates a record with all fields and immediately renders persisted values', async () => {
  vi.mocked(listEquipment).mockResolvedValue([]);
  const saved: EquipmentRecord = { equipment_id: 10, type: 'Speaker', description: 'Portable audio', location: 'Store C', quantity_held: 3, operational_status: 'maintenance', available_quantity: 0, version: 1 };
  vi.mocked(saveEquipment).mockResolvedValue(saved);
  await open(); expect(screen.getByRole('heading', { name: 'No equipment yet' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment' })); fill(); submit();
  expect(await screen.findByRole('status')).toHaveTextContent('Speaker saved.');
  expect(saveEquipment).toHaveBeenCalledWith('token', expect.any(AbortSignal), { type: 'Speaker', description: 'Portable audio', location: 'Store C', quantity_held: 3, operational_status: 'maintenance' }, null);
  const item = within(screen.getByRole('article', { name: 'Speaker' }));
  expect(item.getByText('Store C')).toBeInTheDocument(); expect(item.getByText('3')).toBeInTheDocument(); expect(item.getByText('0')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'No equipment yet' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
  expect(screen.queryByText('Speaker saved.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('article', { name: 'Speaker' })).toBeInTheDocument();
});

test('[NORMAL] [SG2-52:AC1,AC2] an update replaces only its own record and clears old confirmation when edited again', async () => {
  vi.mocked(saveEquipment).mockResolvedValue({ ...record, quantity_held: 3, type: 'Speaker', description: 'Portable audio', location: 'Store C', operational_status: 'maintenance', available_quantity: 0, version: 3 });
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Edit Microphone' })); fill(); submit('Edit equipment');
  expect(await screen.findByRole('status')).toHaveTextContent('Speaker saved.');
  expect(saveEquipment).toHaveBeenCalledWith('token', expect.any(AbortSignal), expect.objectContaining({ type: 'Speaker', operational_status: 'maintenance' }), record);
  expect(screen.queryByRole('article', { name: 'Microphone' })).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Projector' })).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Speaker' }));
  expect(screen.getByLabelText('Quantity held')).toHaveValue(3);
  expect(screen.queryByText('Speaker saved.')).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-52:AC3] read-only access displays equipment with no create or update control', async () => {
  vi.mocked(loadAccess).mockResolvedValue({ userId: 'coordinator', role: 'Event Coordinator', permissions: ['equipment.read'] });
  await open();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Add equipment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
});

test.each([null, { ...staff, permissions: [] }])('[FAILURE] [SG2-52:AC3] missing read permission refuses the catalogue and remains retryable', async identity => {
  vi.mocked(loadAccess).mockResolvedValueOnce(identity);
  render(<EquipmentDesk accessToken="token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Only Technical Support Staff can maintain equipment records.');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('article', { name: 'Microphone' })).toBeInTheDocument();
});

test.each([new Error('Network secret'), new EquipmentError(503)])('[FAILURE] [SG2-52:AC1] catalogue load failures show safe recovery and retry successfully', async failure => {
  vi.mocked(listEquipment).mockRejectedValueOnce(failure);
  render(<EquipmentDesk accessToken="token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentError ? failure.message : 'Unable to load equipment records. Please try again.');
  expect(screen.queryByText('Network secret')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('article', { name: 'Microphone' })).toBeInTheDocument();
});

test.each([new Error('Network secret'), new EquipmentError(400)])('[FAILURE] [SG2-52:AC1] save failure retains every input for correction or retry', async failure => {
  vi.mocked(saveEquipment).mockRejectedValueOnce(failure).mockResolvedValue({ ...record, type: 'Speaker' });
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Add equipment' })); fill(); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentError ? failure.message : 'Unable to save equipment. Your changes are still in the form. Please try again.');
  expect(screen.getByLabelText('Equipment type')).toHaveValue('Speaker'); expect(screen.getByLabelText('Description')).toHaveValue('Portable audio');
  expect(screen.getByLabelText('Location')).toHaveValue('Store C'); expect(screen.getByLabelText('Quantity held')).toHaveValue(3); expect(screen.getByLabelText('Operational status')).toHaveValue('maintenance');
  expect(screen.getByRole('button', { name: 'Save equipment' })).toBeEnabled();
  submit(); expect(await screen.findByRole('status')).toHaveTextContent('Speaker saved.'); expect(saveEquipment).toHaveBeenCalledTimes(2);
});

test.each([401, 403])('[FAILURE] [SG2-52:AC3] HTTP %i during save revokes visible records and edit controls', async status => {
  vi.mocked(saveEquipment).mockRejectedValue(new EquipmentError(status));
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Edit Microphone' })); fill(); submit('Edit equipment');
  expect(await screen.findByRole('alert')).toHaveTextContent(new EquipmentError(status).message);
  expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('article', { name: 'Microphone' })).toBeInTheDocument();
});

test('[CONFLICT] [SG2-52:AC1] a stale update retains edits, stops repeats and reloads current server records', async () => {
  vi.mocked(saveEquipment).mockRejectedValue(new EquipmentError(409));
  vi.mocked(listEquipment).mockResolvedValueOnce([record, other]).mockResolvedValue([{ ...record, quantity_held: 12, available_quantity: 12, version: 3 }]);
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Edit Microphone' })); fill(); submit('Edit equipment');
  expect(await screen.findByRole('alert')).toHaveTextContent('This record changed while you were editing.');
  expect(screen.getByLabelText('Equipment type')).toHaveValue('Speaker');
  expect(screen.getByRole('button', { name: 'Save equipment' })).toBeDisabled(); submit('Edit equipment'); expect(saveEquipment).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reload records' }));
  expect(await screen.findByRole('article', { name: 'Microphone' })).toBeInTheDocument(); expect(listEquipment).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Microphone' })); expect(screen.getByLabelText('Quantity held')).toHaveValue(12);
  expect(screen.getByRole('button', { name: 'Save equipment' })).toBeEnabled();
});

test('[CONFLICT] [SG2-52:AC1] cancelling a rejected update clears the stale error and lets another edit start', async () => {
  vi.mocked(saveEquipment).mockRejectedValue(new EquipmentError(409));
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Edit Microphone' })); submit('Edit equipment');
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Projector' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Reload records' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save equipment' })).toBeEnabled();
});

test('[CONFLICT] [SG2-52:AC1] simultaneous submission dispatches one mutation while its form is disabled', async () => {
  const pending = deferred<EquipmentRecord>(); vi.mocked(saveEquipment).mockReturnValue(pending.promise);
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Add equipment' })); fill();
  const form = screen.getByRole('form', { name: 'Add equipment' });
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(saveEquipment).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => pending.resolve({ ...record, type: 'Speaker' })); expect(screen.getByRole('status')).toHaveTextContent('Speaker saved.');
});

test.each(['resolve', 'reject'] as const)('[CONFLICT] [SG2-52:AC3] late load %s after identity change cannot expose old records or errors', async outcome => {
  const pending = deferred<EquipmentRecord[]>(); vi.mocked(listEquipment).mockReturnValueOnce(pending.promise).mockResolvedValue([other]);
  const view = render(<EquipmentDesk accessToken="old-token" />);
  const signal = vi.mocked(listEquipment).mock.calls[0][1];
  view.rerender(<EquipmentDesk accessToken="new-token" />);
  expect(signal.aborted).toBe(true); await screen.findByRole('article', { name: 'Projector' });
  await act(async () => { if (outcome === 'resolve') pending.resolve([record]); else pending.reject(new Error('Old private request')); });
  expect(screen.queryByRole('article', { name: 'Microphone' })).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Projector' })).toBeInTheDocument();
});

test.each(['resolve', 'reject'] as const)('[CONFLICT] [SG2-52:AC3] late save %s after identity change is aborted and cannot change the new session', async outcome => {
  const pending = deferred<EquipmentRecord>(); vi.mocked(saveEquipment).mockReturnValue(pending.promise);
  const view = await open(); fireEvent.click(screen.getByRole('button', { name: 'Add equipment' })); fill(); submit();
  const signal = vi.mocked(saveEquipment).mock.calls[0][1];
  vi.mocked(listEquipment).mockResolvedValue([other]); view.rerender(<EquipmentDesk accessToken="new-token" />);
  expect(signal.aborted).toBe(true); await screen.findByRole('article', { name: 'Projector' });
  await act(async () => { if (outcome === 'resolve') pending.resolve({ ...record, type: 'Old account speaker' }); else pending.reject(new EquipmentError(403)); });
  expect(screen.queryByText('Old account speaker')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Projector' })).toBeInTheDocument();
});

test('[CONFLICT] [SG2-52:AC3] unmount aborts in-flight reads and saves without late warnings', async () => {
  const loading = deferred<EquipmentRecord[]>(); vi.mocked(listEquipment).mockReturnValueOnce(loading.promise);
  const first = render(<EquipmentDesk accessToken="token" />); const readSignal = vi.mocked(listEquipment).mock.calls[0][1]; first.unmount(); expect(readSignal.aborted).toBe(true);
  await act(async () => loading.reject(new Error('Aborted read')));
  const saving = deferred<EquipmentRecord>(); vi.mocked(saveEquipment).mockReturnValue(saving.promise);
  const second = await open(); fireEvent.click(screen.getByRole('button', { name: 'Add equipment' })); fill(); submit();
  const writeSignal = vi.mocked(saveEquipment).mock.calls[0][1]; second.unmount(); expect(writeSignal.aborted).toBe(true);
  await act(async () => saving.resolve(record));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
