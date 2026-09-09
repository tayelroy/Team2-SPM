import express, { Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { checkDatabaseHealth, isSupabaseConfigured } from './db';
import { createRegisterHandler } from './auth/register';
import { createLoginHandler } from './auth/login';
import { createLogoutHandler } from './auth/logout';
import { createMeHandler } from './auth/me';
import { createUpdateRoleHandler } from './auth/roles';

export function createApp(
  databaseHealthCheck = checkDatabaseHealth,
  registerHandler: RequestHandler = createRegisterHandler(),
  loginHandler: RequestHandler = createLoginHandler(),
  logoutHandler: RequestHandler = createLogoutHandler(),
  meHandler: RequestHandler = createMeHandler(),
  updateRoleHandler: RequestHandler = createUpdateRoleHandler()
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.post('/api/auth/register', registerHandler);
  app.post('/api/auth/login', loginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.get('/api/auth/me', meHandler);
  app.patch('/api/users/:userId/role', updateRoleHandler);

  // Base health check endpoint (satisfies Acceptance Criterion 2)
  app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: 'ConnectSphere Backend',
      database: {
        provider: 'Supabase',
        configured: isSupabaseConfigured(),
        supabaseClient: isSupabaseConfigured() ? 'configured' : 'unconfigured'
      }
    });
  });

  // Database health check endpoint
  app.get(['/health/db', '/api/health/db'], async (_req: Request, res: Response) => {
    try {
      const dbHealth = await databaseHealthCheck();
      const hasError =
        dbHealth.configured &&
        dbHealth.supabase.status === 'error';

      res.status(hasError ? 503 : 200).json({
        status: hasError ? 'degraded' : 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: 'ConnectSphere Backend',
        // Public readiness data is an allowlist. Keep internal errors and URLs
        // in the health helpers; never serialize their complete result here.
        database: {
          provider: dbHealth.provider,
          configured: dbHealth.configured,
          supabase: {
            configured: dbHealth.supabase.configured,
            status: dbHealth.supabase.status
          }
        }
      });
    } catch {
      // Configuration/initialization failures must not reach Express's HTML
      // error handler or leave an unhandled rejection in Express 4.
      res.status(503).json({ status: 'degraded' });
    }
  });

  return app;
}

export const app = createApp();
export default app;
