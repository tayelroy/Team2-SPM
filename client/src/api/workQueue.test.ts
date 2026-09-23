import { afterEach, expect, test, vi } from 'vitest';
import { fetchWorkQueue } from './workQueue';

afterEach(() => vi.unstubAllGlobals());

test('list and selected item use the authenticated, uncached API and preserve the server records', async () => {
  const items = [{ item_id: 7, title: 'Selected request' }];
  const fetch = vi.fn(async () => Response.json({ items }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchWorkQueue('token', null)).toEqual({ ok: true, items });
  expect(await fetchWorkQueue('token', { kind: 'venue', item_id: 7 })).toEqual({ ok: true, items });
  expect(fetch.mock.calls).toEqual([
    ['/api/work-queue', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
    ['/api/work-queue/venue/7', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
  ]);
});

test('missing credentials do not send a request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await fetchWorkQueue(null, null)).toEqual({ ok: false, error: 'Sign in again to view your work queue.' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([401, 403, 404, 503])('HTTP %s returns the appropriate recovery instruction', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  const result = await fetchWorkQueue('token', null);
  expect(result.ok).toBe(false);
  expect(result).toEqual({ ok: false, error: status === 401 || status === 403
    ? 'Your account cannot view this work queue. Sign in again.'
    : status === 404 ? 'This item is no longer in your work queue. Return to the queue to refresh it.'
      : 'Your work queue is temporarily unavailable. Please try again.' });
});

test.each(['offline', 'invalid-json', 'null', 'missing-items', 'missing-detail', 'ambiguous-detail'])('%s never becomes a successful empty queue', async scenario => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (scenario === 'offline') throw new TypeError('Offline');
    if (scenario === 'invalid-json') return new Response('<html>error</html>');
    return Response.json(scenario === 'null' ? null : scenario === 'missing-items' ? {} :
      { items: scenario === 'ambiguous-detail' ? [{}, {}] : [] });
  }));
  expect(await fetchWorkQueue('token', { kind: 'event', item_id: 1 })).toEqual({ ok: false, error: 'Your work queue is temporarily unavailable. Please try again.' });
});
