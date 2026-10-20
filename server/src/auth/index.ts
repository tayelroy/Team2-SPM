import { Request, RequestHandler, Router } from 'express';
import { AccessError, PERMISSIONS, PermissionMap, permissionsFor, Principal, ResolvedPrincipal, Role } from './policy';
import { resolveSupabasePrincipal } from './supabase';
import { ACTING_ROLE_HEADER, ActingRoleError, heldRolesOf, runAsActingRole, selectActingRole } from './actingRole';

export { AccessError, ROLES } from './policy';
export type { Role, Principal, PermissionMap, ResolvedPrincipal } from './policy';

export interface AuthorizationOptions {
  // Override these dependencies when constructing a test instance.
  resolvePrincipal?: (token: string) => Promise<ResolvedPrincipal>;
  permissions?: PermissionMap;
}

export function createAuthorization({
  resolvePrincipal = resolveSupabasePrincipal,
  permissions = PERMISSIONS
}: AuthorizationOptions = {}) {
  const principals = new WeakMap<Request, Principal>();
  // Copy the policy to isolate it from changes to the caller's arrays.
  const policy = Object.fromEntries(Object.entries(permissions).map(([action, roles]) => [action, [...roles]]));

  // Every value of a header, in the order sent; Node would otherwise join
  // repeated custom headers into one comma-separated string.
  const headerValues = (req: Request, name: string) => req.rawHeaders
    .filter((_, index) => index % 2 === 1 && req.rawHeaders[index - 1].toLowerCase() === name);

  const requireAuth: RequestHandler = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    principals.delete(req);
    let acting: { principal: Principal; role: Role };
    try {
      const authorization = headerValues(req, 'authorization');
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization[0] ?? '');
      if (authorization.length !== 1 || !match) throw new AccessError(401);
      const resolved = await resolvePrincipal(match[1]);
      // SG2-104: every role the account holds, then the one this request acts as.
      const roles = heldRolesOf(resolved);
      const role = selectActingRole(roles, headerValues(req, ACTING_ROLE_HEADER));
      acting = { principal: Object.freeze({ userId: resolved.userId, role, roles }), role };
    } catch (error) {
      if (error instanceof ActingRoleError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      const failure = error instanceof AccessError ? error : new AccessError(503);
      if (failure.status === 401) res.set('WWW-Authenticate', 'Bearer');
      res.status(failure.status).json({ error: failure.message });
      return;
    }
    principals.set(req, acting.principal);
    // The rest of the request, including its database calls, acts as this role.
    runAsActingRole(acting.role, next);
  };

  const requirePermission = (action: string): RequestHandler => (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const principal = principals.get(req);
    if (!principal) {
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!permissionsFor(principal.role, policy).includes(action)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    next();
  };

  /** Creates a router with authentication middleware. Add action guards per route. */
  const protectedRouter = () => {
    const router = Router();
    router.use(requireAuth);
    return router;
  };

  const router = protectedRouter();
  router.get('/me', (req, res) => {
    const principal = principals.get(req)!;
    // SG2-104: the acting role's permissions, plus every role the account holds.
    res.json({ userId: principal.userId, role: principal.role, roles: principal.roles, permissions: permissionsFor(principal.role, policy) });
  });

  return {
    router, requireAuth, requirePermission, protectedRouter,
    getPrincipal: (req: Request) => principals.get(req)
  };
}

export const authorization = createAuthorization();
