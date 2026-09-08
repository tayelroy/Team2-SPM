import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  isInternal: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Temporary stand-in for the real authentication system (SG2-23 log in/out,
 * SG2-24 account roles). Reads the caller's identity from headers so profile
 * and event-request work isn't blocked waiting on auth to land first.
 *
 * TODO(SG2-23/SG2-24): replace with real session/JWT-based auth once available.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header('x-user-id');
  if (!userId) {
    res.status(401).json({
      error: 'Missing x-user-id header (temporary auth stand-in pending SG2-23/24)'
    });
    return;
  }

  req.user = {
    id: userId,
    isInternal: req.header('x-user-internal') === 'true'
  };
  next();
}
