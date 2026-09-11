import express, { Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { checkDatabaseHealth, isSupabaseConfigured } from './db';
import { createRegisterHandler } from './auth/register';
import { authorization } from './auth';
import { createEventDraftHandler } from './events/createDraft';
import { createVenuesRouter } from './venues';

export function createApp(
  databaseHealthCheck = checkDatabaseHealth,
  registerHandler: RequestHandler = createRegisterHandler(),
  access = authorization,
  eventDraftHandler: RequestHandler = createEventDraftHandler({ getPrincipal: access.getPrincipal })
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.post('/api/auth/register', registerHandler);
  app.use('/api/auth', access.router);
  app.use('/api/venues', createVenuesRouter(access));

  // SG2-28: raise an event request as a draft.
  const eventRequests = access.protectedRouter();
  eventRequests.post('/', access.requirePermission('event_request.create'), eventDraftHandler);
  app.use('/api/event-requests', eventRequests);

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
