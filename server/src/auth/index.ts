import { Request, RequestHandler, Router } from 'express';
import { AccessError, isRole, PERMISSIONS, PermissionMap, permissionsFor, Principal } from './policy';
import { resolveSupabasePrincipal } from './supabase';

export { AccessError, ROLES } from './policy';
export type { Role, Principal, PermissionMap } from './policy';

export interface AuthorizationOptions {
  // Override these dependencies when constructing a test instance.
  resolvePrincipal?: (token: string) => Promise<Principal>;
  permissions?: PermissionMap;
}

export function createAuthorization({
  resolvePrincipal = resolveSupabasePrincipal,
  permissions = PERMISSIONS
}: AuthorizationOptions = {}) {
  const principals = new WeakMap<Request, Principal>();
  // Copy the policy to isolate it from changes to the caller's arrays.
  const policy = Object.fromEntries(Object.entries(permissions).map(([action, roles]) => [action, [...roles]]));

  const requireAuth: RequestHandler = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    principals.delete(req);
    try {
      const headerCount = req.rawHeaders.filter((_, index) =>
        index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'authorization').length;
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(req.get('authorization') ?? '');
      if (headerCount !== 1 || !match) throw new AccessError(401);
      const principal = await resolvePrincipal(match[1]);
      if (!principal.userId || !isRole(principal.role)) throw new AccessError(403);
      principals.set(req, Object.freeze({ userId: principal.userId, role: principal.role }));
      next();
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      if (failure.status === 401) res.set('WWW-Authenticate', 'Bearer');
      res.status(failure.status).json({ error: failure.message });
    }
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
    res.json({ ...principal, permissions: permissionsFor(principal.role, policy) });
  });

  return {
    router, requireAuth, requirePermission, protectedRouter,
    getPrincipal: (req: Request) => principals.get(req)
  };
}

export const authorization = createAuthorization();
