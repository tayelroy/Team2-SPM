import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';
import { createEquipmentStore } from './equipment';
import { AccessError } from '../auth/policy';

const original = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = 'https://equipment-test.supabase.co';
  dbConfig.supabaseAnonKey = 'publishable-key';
  dbConfig.supabaseServiceRoleKey = 'NEVER_SEND_ADMIN';
});
afterEach(() => { mock.restoreAll(); Object.assign(dbConfig, original); });
const values = { type: 'Microphone', description: 'Wireless handheld', quantity_held: 8,
  location: 'Store A', operational_status: 'operational' as const };
const saved = { ...values, equipment_id: 7, available_quantity: 8, version: 1 };
const stored = { name: values.type, description: values.description, quantity_total: values.quantity_held,
  location: values.location, operational_status: values.operational_status };
type Call = { method: string; url: URL; body?: unknown };
function serve(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://equipment-test.supabase.co');
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(url.pathname, '/rest/v1/equipment');
    assert.equal(url.searchParams.get('select'), 'equipment_id,type:name,description,quantity_held:quantity_total,location,operational_status,available_quantity,version');
    const call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

test('[NORMAL] [SG2-52:AC1] listing uses the caller token, public field aliases and stable type/identity ordering', async () => {
  const calls = serve(() => Response.json([saved]));
  assert.deepEqual(await createEquipmentStore('staff-token').list(), [saved]);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url.searchParams.get('order'), 'name.asc,equipment_id.asc');
  assert.equal(calls[0].url.searchParams.get('offset'), '0');
  assert.equal(calls[0].url.searchParams.get('limit'), '1000');
});

test('[BOUNDARY] [SG2-52:AC1] an inventory above the provider row limit retains every equipment record across ordered pages', async () => {
  const inventory = Array.from({ length: 1001 }, (_, index) => ({ ...saved, equipment_id: index + 1 }));
  const calls = serve(call => {
    const offset = Number(call.url.searchParams.get('offset'));
    const limit = Number(call.url.searchParams.get('limit'));
    assert.equal(limit, 1000);
    assert.equal(call.url.searchParams.get('order'), 'name.asc,equipment_id.asc');
    return Response.json(inventory.slice(offset, offset + limit));
  });
  assert.deepEqual(await createEquipmentStore('staff-token').list(), inventory);
  assert.deepEqual(calls.map(call => call.url.searchParams.get('offset')), ['0', '1000']);
});

test('[NORMAL] [SG2-52:AC1] create preserves existing equipment storage columns and returns the database-computed record', async () => {
  const calls = serve(() => Response.json(saved));
  assert.deepEqual(await createEquipmentStore('staff-token').create(values), saved);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, stored);
});

test('[NORMAL] [SG2-52:AC1] editing filters both identity and version atomically without writing caller-controlled version/availability', async () => {
  const calls = serve(() => Response.json({ ...saved, version: 2 }));
  assert.deepEqual(await createEquipmentStore('staff-token').update(7, 1, values), { ...saved, version: 2 });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url.searchParams.get('equipment_id'), 'eq.7');
  assert.equal(calls[0].url.searchParams.get('version'), 'eq.1');
  assert.deepEqual(calls[0].body, stored);
});

test('[BOUNDARY] [SG2-52:AC1] an empty inventory is a successful empty list', async () => {
  serve(() => Response.json([]));
  assert.deepEqual(await createEquipmentStore('staff-token').list(), []);
});

test('[FAILURE] [SG2-52:AC1] a list response without data fails closed instead of returning a malformed inventory', async () => {
  serve(() => Response.json(null));
  await assert.rejects(createEquipmentStore('staff-token').list(), (error: unknown) => error instanceof AccessError && error.status === 503);
});

test('[CONFLICT] [SG2-52:AC1] a stale or missing update returns null and a create without a row does not invent success', async () => {
  serve(() => Response.json(null));
  const store = createEquipmentStore('staff-token');
  assert.equal(await store.update(7, 1, values), null);
  assert.equal(await store.create(values), null);
});

test('[FAILURE] [SG2-52:AC3] authentication, policy denial and storage outages retain only their public status', async () => {
  for (const [status, code, expected] of [[401, 'AUTH', 401], [403, 'DENIED', 403], [400, '42501', 403], [500, 'DB_PRIVATE', 503]] as const) {
    serve(() => Response.json({ message: 'PRIVATE_STORAGE_DETAIL', code }, { status }));
    const store = createEquipmentStore('staff-token');
    for (const operation of [() => store.list(), () => store.create(values), () => store.update(7, 1, values)]) {
      await assert.rejects(operation(), (error: unknown) => error instanceof AccessError && error.status === expected
        && !error.message.includes('PRIVATE_STORAGE_DETAIL'));
    }
    mock.restoreAll();
  }
});

test('[FAILURE] [SG2-52:AC3] missing user-scoped configuration fails closed before querying', () => {
  assert.throws(() => createEquipmentStore('staff-token', () => null), (error: unknown) => error instanceof AccessError && error.status === 503);
});
