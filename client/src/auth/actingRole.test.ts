import { afterEach, expect, test, vi } from 'vitest';
import { installActingRoleHeader, roleCode, withActingRole } from './actingRole';
import { saveSession } from './session';

afterEach(() => sessionStorage.clear());

const signedIn = (role: string) => saveSession({ accessToken: 'tok-1', user: { userId: 'u1', email: 'a@b.c', role, roles: ['Event Coordinator', 'Venue Staff'] } });

test('[NORMAL] [SG2-104:AC1] the app\'s own signed-in API calls name the role the account acts as', () => {
  signedIn('Venue Staff');
  const init = withActingRole('/api/venue-bookings', { headers: { Authorization: 'Bearer tok-1' } });
  expect(new Headers(init?.headers).get('X-Acting-Role')).toBe('venue_staff');
  expect(roleCode('Event Coordinator Lead')).toBe('event_coordinator_lead');
});

test('[FAILURE] [SG2-104:AC2] no acting role is sent to another site, without a token, or with another session\'s token', () => {
  signedIn('Venue Staff');
  for (const [url, auth] of [['https://example.com/api/x', 'Bearer tok-1'], ['/api/x', undefined], ['/api/x', 'Bearer old-token']] as const) {
    const init = withActingRole(url, auth ? { headers: { Authorization: auth } } : undefined);
    expect(new Headers(init?.headers).has('X-Acting-Role')).toBe(false);
  }
  sessionStorage.clear();
  expect(withActingRole('/api/x', { headers: { Authorization: 'Bearer tok-1' } })).toEqual({ headers: { Authorization: 'Bearer tok-1' } });
});

test('[BOUNDARY] [SG2-104:AC4] a single-role session sends no acting role, so a role changed by an administrator applies on the next call', () => {
  for (const roles of [['Event Organiser'], undefined]) {
    saveSession({ accessToken: 'tok-1', user: { userId: 'u1', email: 'a@b.c', role: 'Event Organiser', roles } });
    const init = withActingRole('/api/auth/me', { headers: { Authorization: 'Bearer tok-1' } });
    expect(new Headers(init?.headers).has('X-Acting-Role')).toBe(false);
  }
});

test('[NORMAL] [SG2-104:AC1] the installed hook adds the header to every fetch', async () => {
  signedIn('Event Coordinator');
  const original = vi.fn().mockResolvedValue(new Response('{}'));
  const target = { fetch: original as unknown as typeof fetch };
  installActingRoleHeader(target);
  await target.fetch(new Request('http://localhost/api/me'), undefined);
  await target.fetch('/api/me', { headers: { Authorization: 'Bearer tok-1' } });
  expect(new Headers(original.mock.calls[1][1].headers).get('X-Acting-Role')).toBe('event_coordinator');
  await target.fetch(new URL('http://localhost/x'));
  expect(original).toHaveBeenCalledTimes(3);
});
