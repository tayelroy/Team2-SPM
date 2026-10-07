import { afterEach, expect, test, vi } from 'vitest';
import { EquipmentError, listEquipment, saveEquipment, type EquipmentRecord, type EquipmentValues } from './equipment';
const values: EquipmentValues = { type: 'Wireless microphone', description: 'Handheld', quantity_held: 8, location: 'Store A', operational_status: 'operational' };
const record: EquipmentRecord = { ...values, equipment_id: 7, available_quantity: 8, version: 2 };
afterEach(() => vi.unstubAllGlobals());
test('[NORMAL] [SG2-52:AC1] lists persisted stock using the signed-in token and no caching', async () => {
  const signal = new AbortController().signal;
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ equipment: [record] }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await listEquipment('token', signal)).toEqual([record]);
  expect(fetchMock).toHaveBeenCalledWith('/api/equipment', { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal });
});
test('[NORMAL] [SG2-52:AC1] creates all five equipment fields as JSON', async () => {
  const signal = new AbortController().signal;
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ equipment: record }, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await saveEquipment('token', signal, values, null)).toEqual(record);
  expect(fetchMock).toHaveBeenCalledWith('/api/equipment', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal, body: JSON.stringify(values) });
});
test('[CONFLICT] [SG2-52:AC1] updates the selected ID with its original version', async () => {
  const signal = new AbortController().signal;
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ equipment: { ...record, version: 3 } }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await saveEquipment('token', signal, values, record)).toEqual({ ...record, version: 3 });
  expect(fetchMock).toHaveBeenCalledWith('/api/equipment/7', { method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal, body: JSON.stringify({ ...values, version: 2 }) });
});
test.each([
  [400, 'Complete every field and enter a valid whole-number quantity.'],
  [401, 'Your session has expired. Sign in again.'],
  [403, 'Only Technical Support Staff can maintain equipment records.'],
  [409, 'This record changed while you were editing. Reload records before editing again.'],
  [503, 'Unable to reach the equipment service. Please try again.'],
] as const)('[FAILURE] [SG2-52:AC1] [SG2-52:AC3] HTTP %i has a safe recovery message', (status, message) => {
  expect(new EquipmentError(status).message).toBe(message);
});
test('[FAILURE] [SG2-52:AC1] failed reads and writes surface the server status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(listEquipment('token', new AbortController().signal)).rejects.toThrow('Unable to reach');
  await expect(saveEquipment('token', new AbortController().signal, values, record)).rejects.toMatchObject({ status: 503 });
});
