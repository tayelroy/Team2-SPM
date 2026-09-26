import express, { Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { checkDatabaseHealth, isSupabaseConfigured } from './db';
import { createLoginHandler, createLoginRateLimiter } from './auth/login';
import { createLogoutHandler } from './auth/logout';
import { createUpdateRoleHandler } from './auth/roles';
import { authorization } from './auth';
import { createVenueAvailabilityRouter } from './venues/availability';
import { createEventDraftHandler } from './events/createDraft';
import { submitEventRequestHandler } from './events/submit';
import { getEventRequestsHandler, getEventRequestDetailHandler } from './events/list';
import { createDeleteEventDraftHandler } from './events/deleteDraft';
import { createUpdateEventDraftHandler } from './events/updateDraft';
import { createAssignCoordinatorHandler } from './events/assignCoordinator';
import { createStartEventReviewHandler } from './events/review';
import { createVenuesRouter } from './venues';
import { createVenueLayoutsRouter } from './venues/layouts';
import { createProfileRouter } from './profile';
import { createGetEventStageHandler } from './events/getStage';
import { createWorkQueueRouter } from './workQueue';
import { createUpdateEventPlanningHandler } from './events/updatePlanning';

export function createApp(
  databaseHealthCheck = checkDatabaseHealth,
  access = authorization,
  eventDraftHandler: RequestHandler = createEventDraftHandler({ getPrincipal: access.getPrincipal }),
  loginHandler: RequestHandler = createLoginHandler(),
  logoutHandler: RequestHandler = createLogoutHandler(),
  updateRoleHandler: RequestHandler = createUpdateRoleHandler(),
  loginRateLimit: RequestHandler = createLoginRateLimiter(),
  eventSubmitHandler: RequestHandler = submitEventRequestHandler({ getPrincipal: access.getPrincipal }),
  eventListHandler: RequestHandler = getEventRequestsHandler({ getPrincipal: access.getPrincipal }),
  deleteEventDraftHandler: RequestHandler = createDeleteEventDraftHandler({ getPrincipal: access.getPrincipal }),
  updateEventDraftHandler: RequestHandler = createUpdateEventDraftHandler({ getPrincipal: access.getPrincipal }),
  eventDetailHandler: RequestHandler = getEventRequestDetailHandler({ getPrincipal: access.getPrincipal }),
  routers = {
    availability: createVenueAvailabilityRouter(access),
    venues: createVenuesRouter(access),
    layouts: createVenueLayoutsRouter(access),
    profile: createProfileRouter(access)
  },
  workQueueRouter = createWorkQueueRouter(access),
  eventStageHandler: RequestHandler = createGetEventStageHandler({ getPrincipal: access.getPrincipal }),
  startEventReviewHandler: RequestHandler = createStartEventReviewHandler({ getPrincipal: access.getPrincipal }),
  assignCoordinatorHandler: RequestHandler = createAssignCoordinatorHandler({ getPrincipal: access.getPrincipal }),
  updateEventPlanningHandler: RequestHandler = createUpdateEventPlanningHandler({ getPrincipal: access.getPrincipal })
) {
  const app = express();

  // Vercel puts one proxy hop in front of every request, setting
  // X-Forwarded-For. Without this, express-rate-limit would key its per-IP
  // counter off the proxy's own address — every caller sharing one bucket —
  // and (separately) throws at request time when it sees a forwarded-for
  // header it isn't configured to trust.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json());

  // No self-registration: accounts are seeded directly (see
  // project_seeded_test_accounts memory) rather than created through a
  // public endpoint — customer feedback confirmed roles are pre-seeded.
  app.post('/api/auth/login', loginRateLimit, loginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.use('/api/auth', access.router);
  app.use('/api/venues', routers.availability);

  // Only Technical Support Staff hold the 'users.role.update' permission
  // (see auth/policy.ts) — requireAuth (via protectedRouter) verifies the
  // caller, requirePermission checks that grant on every request.
  const rolesRouter = access.protectedRouter();
  rolesRouter.patch('/:userId/role', access.requirePermission('users.role.update'), updateRoleHandler);
  app.use('/api/users', rolesRouter);

  // SG2-28: raise an event request as a draft.
  const eventRequests = access.protectedRouter();
  eventRequests.post('/', access.requirePermission('event_request.create'), eventDraftHandler);
  // SG2-31: list and view state of event requests.
  eventRequests.get('/', access.requirePermission('event_request.view'), eventListHandler);
  // SG2-30: submit a draft event request for review.
  eventRequests.patch(
    '/:eventId/submit',
    access.requirePermission('event_request.submit'),
    eventSubmitHandler
  );
  // SG2-35: a coordinator opens a request assigned to them for review.
  eventRequests.patch(
    '/:eventId/review',
    access.requirePermission('event_request.review'),
    startEventReviewHandler
  );
  // SG2-39: coordinator updates event information during planning.
  eventRequests.patch(
    '/:eventId/planning',
    access.requirePermission('event_request.planning.update'),
    updateEventPlanningHandler
  );
  // SG2-32: delete a request while it is still a draft.
  eventRequests.delete(
    '/:eventId',
    access.requirePermission('event_request.delete'),
    deleteEventDraftHandler
  );
  // SG2-29: edit a request's own fields while it is still a draft.
  eventRequests.patch(
    '/:eventId',
    access.requirePermission('event_request.update'),
    updateEventDraftHandler
  );
  // SG2-38: see what stage an event has reached.
  eventRequests.get(
    '/:eventId/stage',
    access.requirePermission('event_request.stage.view'),
    eventStageHandler
  );
  // SG2-31: view state and details of a single event request.
  eventRequests.get('/:eventId', access.requirePermission('event_request.view'), eventDetailHandler);
  // SG2-33/SG2-34: Technical Support Staff assign or reassign a coordinator.
  eventRequests.patch(
    '/:eventId/coordinator',
    access.requirePermission('event_request.assign_coordinator'),
    assignCoordinatorHandler
  );
  app.use('/api/event-requests', eventRequests);

  app.use('/api/venues', routers.venues);
  app.use('/api/venues', routers.layouts);

  // SG2-27: view/update the caller's own profile.
  app.use('/api/profile', routers.profile);
  app.use('/api/work-queue', workQueueRouter);

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
