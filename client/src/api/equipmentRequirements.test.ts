import { afterEach, expect, test, vi } from 'vitest';
import { EquipmentRequirementsError, loadEquipmentRequirements, saveEquipmentArrangement, saveEquipmentRequirement, type EquipmentRequirement, type RequirementsView } from './equipmentRequirements';
const record: EquipmentRequirement = { request_id: 11, event_id: 7, equipment_id: 3, equipment_type: 'Microphone', quantity: 4,
  notes: 'Wireless', status: 'pending', arrangement_notes: null, shortfall: null, placement_venue_id: null, placement_venue_name: null, placement_position: null, version: 2 };
const view: RequirementsView = { event: { event_id: 7, name: 'Forum', status: 'approved' }, requests: [record], equipment: [{ equipment_id: 3, type: 'Microphone' }], venues: [], can_request: true, can_arrange: false };
const signal = new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
test('[NORMAL] [SG2-53:AC1] loads event requirements with authenticated uncached transport and cancellation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view)); vi.stubGlobal('fetch', fetch);
  expect(await loadEquipmentRequirements(7, 'token', signal)).toEqual(view);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests?event_id=7', { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal });
});
test('[NORMAL] [SG2-53:AC1] [SG2-53:AC4] creates a typed requirement and returns the complete server view', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view, { status: 201 })); vi.stubGlobal('fetch', fetch);
  expect(await saveEquipmentRequirement(7, 'token', signal, { equipment_id: 3, quantity: 4, notes: 'Wireless' }, null)).toEqual(view);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal,
    body: JSON.stringify({ event_id: 7, equipment_id: 3, quantity: 4, notes: 'Wireless' }) });
});
test('[CONFLICT] [SG2-53:AC2] amendments send the original request version and optional notes as null', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view)); vi.stubGlobal('fetch', fetch);
  expect(await saveEquipmentRequirement(7, 'token', signal, { equipment_id: 3, quantity: 6, notes: null }, record)).toEqual(view);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests/11', { method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal,
    body: JSON.stringify({ event_id: 7, equipment_id: 3, quantity: 6, notes: null, version: 2 }) });
});
test('[NORMAL] [SG2-53:AC5] [SG2-53:AC6] support saves shortfall and per-item placement through the versioned arrangement endpoint', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(view)); vi.stubGlobal('fetch', fetch);
  expect(await saveEquipmentArrangement(7, 'token', signal, { arrangement_notes: 'Two ready', shortfall: 2, placement_venue_id: 9, placement_position: 'Stage left' }, record)).toEqual(view);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests/11/arrangement', { method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal,
    body: JSON.stringify({ event_id: 7, version: 2, arrangement_notes: 'Two ready', shortfall: 2, placement_venue_id: 9, placement_position: 'Stage left' }) });
});
test.each([
  [400, 'Check the equipment, quantities, notes and placement before saving.'], [401, 'Your session has expired. Sign in again.'],
  [403, 'You do not have permission to access or change these equipment requirements.'], [404, 'This event or equipment request is no longer available to you.'],
  [409, 'This request changed, is no longer editable, or duplicates existing equipment. Reload requirements before trying again.'],
  [503, 'Unable to reach the equipment requirements service. Please try again.'],
])('[FAILURE] [SG2-53:AC1] [SG2-53:AC3] HTTP %i preserves its status and a safe recovery message', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'private server detail' }, { status })));
  await expect(loadEquipmentRequirements(7, 'token', signal)).rejects.toMatchObject({ status, message });
  expect(new EquipmentRequirementsError(status).message).toBe(message);
});
test('[BOUNDARY] [SG2-53:AC1] transport failures and unreadable successful responses reject instead of fabricating a view', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('not-json', { status: 200 })); vi.stubGlobal('fetch', fetch);
  await expect(loadEquipmentRequirements(7, 'token', signal)).rejects.toThrow('offline');
  await expect(saveEquipmentRequirement(7, 'token', signal, { equipment_id: 3, quantity: 1, notes: null }, null)).rejects.toThrow();
});
