import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';
import { createVenueOperationStore } from './venueOperations';
import { AccessError } from '../auth/policy';

const original = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = 'https://venue-test.supabase.co';
  dbConfig.supabaseAnonKey = 'publishable-key';
  dbConfig.supabaseServiceRoleKey = 'NEVER_SEND_ADMIN';
});
afterEach(() => { mock.restoreAll(); Object.assign(dbConfig, original); });

const values = { setup_minutes: 30, turnaround_minutes: 45, emergency_access: 'Side exit', known_restrictions: null };
type Call = { method: string; pathname: string; search: string; body?: unknown; prefer: string | null };

function serve(respond: (call: Call) => Response, token = 'staff-token') {
  const calls: Call[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.equal(headers.get('authorization'), `Bearer ${token}`);
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    const call = {
      method: init?.method ?? 'GET', pathname: url.pathname, search: url.search,
      body: init?.body ? JSON.parse(init.body as string) : undefined, prefer: headers.get('prefer')
    };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

test('[NORMAL] [SG2-77:AC1] [SG2-77:AC6] save upserts the venue\'s row with the caller\'s token after confirming the venue exists', async () => {
  const calls = serve(call => call.pathname === '/rest/v1/venues'
    ? Response.json({ venue_id: 7 })
    : Response.json({ ...values, updated_at: '2026-10-05T03:00:00.000Z' }));
  const result = await createVenueOperationStore('staff-token').save(7, values);
  assert.deepEqual(result, { ...values, updated_at: '2026-10-05T03:00:00.000Z' });
  assert.deepEqual(calls.map(call => `${call.method} ${call.pathname}`), ['GET /rest/v1/venues', 'POST /rest/v1/venue_operations']);
  assert.deepEqual(calls[1].body, { venue_id: 7, ...values });
  assert.match(calls[1].search, /on_conflict=venue_id/);
  assert.match(calls[1].prefer ?? '', /resolution=merge-duplicates/);
});

test('[NORMAL] [SG2-77:AC1] get returns the saved row for the venue', async () => {
  const saved = { ...values, updated_at: '2026-10-05T03:00:00.000Z' };
  const calls = serve(call => Response.json(call.pathname === '/rest/v1/rpc/venue_exists_for_operations_read' ? true : saved));
  assert.deepEqual(await createVenueOperationStore('staff-token').get(7), saved);
  assert.match(calls[1].search, /venue_id=eq\.7/);
});

test('[BOUNDARY] [SG2-77:AC3] get returns 0 minutes and no safety details when the venue has no row', async () => {
  serve(call => Response.json(call.pathname === '/rest/v1/rpc/venue_exists_for_operations_read' ? true : null));
  assert.deepEqual(await createVenueOperationStore('staff-token').get(7), {
    setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null
  });
});

test('[FAILURE] [SG2-77:AC1] get and save return null without touching venue_operations when the venue does not exist', async () => {
  const calls = serve(call => Response.json(call.pathname.includes('/rpc/') ? false : null));
  const store = createVenueOperationStore('staff-token');
  assert.equal(await store.get(999), null);
  assert.equal(await store.save(999, values), null);
  assert.deepEqual(calls.map(call => call.pathname), ['/rest/v1/rpc/venue_exists_for_operations_read', '/rest/v1/venues']);
});

test('[FAILURE] [SG2-77:AC6] a refused write surfaces as 403 and an outage as 503', async () => {
  for (const [status, expected] of [[403, 403], [401, 401], [500, 503]] as const) {
    serve(call => call.pathname === '/rest/v1/venues'
      ? Response.json({ venue_id: 7 })
      : Response.json({ message: 'denied' }, { status }));
    await assert.rejects(createVenueOperationStore('staff-token').save(7, values),
      (error: unknown) => error instanceof AccessError && error.status === expected);
    mock.restoreAll();
  }
});

test('[FAILURE] [SG2-77:AC6] the store refuses to start without an https database URL', () => {
  dbConfig.supabaseUrl = 'http://insecure.example';
  assert.throws(() => createVenueOperationStore('staff-token'), (error: unknown) => error instanceof AccessError && error.status === 503);
  dbConfig.supabaseUrl = undefined;
  assert.throws(() => createVenueOperationStore('staff-token'), (error: unknown) => error instanceof AccessError && error.status === 503);
});


test('[NORMAL] [SG2-77:AC5] [SG2-86:AC2] Safety reads saved nonzero operations through the narrow existence RPC using only its caller token', async () => {
  const saved = { setup_minutes: 10, turnaround_minutes: 15, emergency_access: 'Signed east exit', known_restrictions: 'No open flames', updated_at: '2026-10-16T06:00:00Z' };
  const calls = serve(call => Response.json(call.pathname.includes('/rpc/') ? true : saved), 'safety-token');
  assert.deepEqual(await createVenueOperationStore('safety-token').get(7), saved);
  assert.deepEqual(calls.map(call => `${call.method} ${call.pathname}`), [
    'POST /rest/v1/rpc/venue_exists_for_operations_read', 'GET /rest/v1/venue_operations'
  ]);
  assert.deepEqual(calls[0].body, { p_venue_id: 7 });
  assert.match(calls[1].search, /venue_id=eq\.7/);
});

test('[FAILURE] [SG2-77:AC5] [SG2-77:AC6] refused or unavailable existence and operations reads preserve access errors instead of claiming a missing venue', async () => {
  for (const stage of ['identity', 'operations']) {
    for (const [status, expected] of [[401, 401], [403, 403], [404, 503], [500, 503]] as const) {
      const calls = serve(call => stage === 'operations' && call.pathname.includes('/rpc/')
        ? Response.json(true) : Response.json({ message: 'Unavailable' }, { status }));
      await assert.rejects(createVenueOperationStore('staff-token').get(7),
        (error: unknown) => error instanceof AccessError && error.status === expected);
      assert.equal(calls.length, stage === 'identity' ? 1 : 2);
      mock.restoreAll();
    }
  }
});

test('[BOUNDARY] [SG2-77:AC5] malformed existence responses fail closed without reading operations or returning missing-venue defaults', async () => {
  for (const data of [null, [], {}, 'true', 1]) {
    const calls = serve(() => Response.json(data));
    await assert.rejects(createVenueOperationStore('staff-token').get(7),
      (error: unknown) => error instanceof AccessError && error.status === 503);
    assert.equal(calls.length, 1);
    mock.restoreAll();
  }
});
