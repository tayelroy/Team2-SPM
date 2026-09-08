import { afterEach, expect, test, vi } from 'vitest';
import { can, loadAccess } from './access';

afterEach(() => vi.unstubAllGlobals());

test('logged-out pages deny access without making a request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await loadAccess(null)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(can(null, 'event.edit')).toBe(false);
  expect(can(undefined, 'event.edit')).toBe(false);
});

test('loads only the server-provided permissions with the session token', async () => {
  const controller = new AbortController();
  const access = { userId: 'user', role: 'event_organiser', permissions: ['fixture.edit'] };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...access, secret: 'not retained' }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await loadAccess('session-token', controller.signal);
  expect(result).toEqual(access);
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
    headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal
  });
  expect(can(result, 'fixture.edit')).toBe(true);
  expect(can(result, 'event.delete')).toBe(false);
});

test.each([401, 403])('denies access when the server returns %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
  expect(await loadAccess('token')).toBeNull();
});

test('outage and abort failures cannot produce a granted access result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(loadAccess('token')).rejects.toThrow('Unable to load access permissions');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(loadAccess('token')).rejects.toThrow('Aborted');
});

test.each([
  null, {}, { userId: 5 }, { userId: '' }, { userId: 'user', role: 5 },
  { userId: 'user', role: '' }, { userId: 'user', role: 'attendee', permissions: 'all' },
  { userId: 'user', role: 'attendee', permissions: [123] }
])('rejects malformed access responses: %j', async data => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  await expect(loadAccess('token')).rejects.toThrow('Invalid access response');
});

test('reloading observes removed permissions and retains no global cache', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ userId: 'user', role: 'event_organiser', permissions: ['fixture.edit'] }))
    .mockResolvedValueOnce(Response.json({ userId: 'user', role: 'attendee', permissions: [] })));
  expect(can(await loadAccess('token'), 'fixture.edit')).toBe(true);
  expect(can(await loadAccess('token'), 'fixture.edit')).toBe(false);
});
