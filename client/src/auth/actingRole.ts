import { loadSession } from './session';

/** The server's code for a display role: "Venue Staff" -> "venue_staff". */
export function roleCode(role: string): string {
  return role.toLowerCase().replace(/ /g, '_');
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * SG2-104: an account can hold several roles and acts as one at a time. Every
 * signed-in call to the app's own API names that role in X-Acting-Role, and
 * the server checks the account holds it. Only requests carrying the stored
 * session's own token get the header, so a stale role never leaks onto
 * another session or another site.
 */
export function withActingRole(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  const session = loadSession();
  if (!session || !requestUrl(input).startsWith('/api/')) return init;
  const headers = new Headers(init?.headers);
  if (headers.get('Authorization') !== `Bearer ${session.accessToken}`) return init;
  headers.set('X-Acting-Role', roleCode(session.user.role));
  return { ...init, headers };
}

/** Adds the acting-role header to every fetch the app makes. Called once at startup. */
export function installActingRoleHeader(target: { fetch: typeof fetch } = window): void {
  const original = target.fetch.bind(target);
  target.fetch = (input, init) => original(input, withActingRole(input, init));
}
