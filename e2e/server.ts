/** Test-only composition root. Never imported by the production server or
 * deployment. The React production build calls the real Express API over HTTP;
 * only external identity and database providers are replaced with local state. */
import express, { type RequestHandler } from 'express';
import path from 'node:path';
import { createApp } from '../server/src/app';
import { createAuthorization } from '../server/src/auth';
import { createLoginHandler, createLoginRateLimiter, loginAccount } from '../server/src/auth/login';
import { createLogoutHandler, logoutAccount } from '../server/src/auth/logout';
import { createUpdateRoleHandler } from '../server/src/auth/roles';
import { createEventDraftHandler } from '../server/src/events/createDraft';
import { createUpdateEventDraftHandler } from '../server/src/events/updateDraft';
import { createDeleteEventDraftHandler } from '../server/src/events/deleteDraft';
import { submitEventRequestHandler } from '../server/src/events/submit';
import { getEventRequestsHandler, getEventRequestDetailHandler } from '../server/src/events/list';
import { createStartEventReviewHandler } from '../server/src/events/review';
import { createDecideEventRequestHandler } from '../server/src/events/decide';
import { createCompleteEventHandler } from '../server/src/events/complete';
import { createAssignCoordinatorHandler } from '../server/src/events/assignCoordinator';
import { createUpdateEventPlanningHandler } from '../server/src/events/updatePlanning';
import { createListAssignableHandler } from '../server/src/events/listAssignable';
import { createGetEventHistoryHandler } from '../server/src/events/getHistory';
import { createAddClarificationHandler, createListClarificationsHandler } from '../server/src/events/clarifications';
import { createVenuesRouter } from '../server/src/venues';
import { createVenueLayoutsRouter } from '../server/src/venues/layouts';
import { createVenueOperationsRouter } from '../server/src/venues/operations';
import { DEFAULT_OPERATIONS, type VenueOperationRecord } from '../server/src/venues/operationFields';
import { createVenueBlocksRouter } from '../server/src/venues/blocks';
import { createVenueSearchHandler, createVenueSearchRouter } from '../server/src/venues/search';
import { createBookingRequestSuitabilityRouter, createVenueSuitabilityRouter } from '../server/src/venues/suitabilityRoutes';
import { createVenueBookingRequestsRouter } from '../server/src/venues/bookingRequests';
import { createNotificationsRouter } from '../server/src/notifications';
import { createMemoryDecisionStore, memoryNotifications } from './support/venue-decisions';
import { createProfileRouter } from '../server/src/profile';
import { createAvailabilityHandler, createAllVenuesAvailabilityHandler } from '../server/src/venues/availability';
import type { VenueRecord } from '../server/src/venues/fields';
import type { VenueLayoutRecord } from '../server/src/venues/layoutFields';
import type { BookingConflict, VenueBlockRecord } from '../server/src/venues/blockFields';
import { dbConfig } from '../server/src/db';
import { MemoryDatabase } from './support/memory-database';
import { createWorkQueueRouter } from '../server/src/workQueue';
import { createVenueHoldsRouter } from '../server/src/venues/holds';
import { VenueHoldFixture } from './support/venue-holds';

// Application configuration may load a developer's .env during imports. Clear
// database configuration before serving any request, including health routes.
for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
for (const key of Object.keys(process.env)) if (key.startsWith('SUPABASE_')) delete process.env[key];
const database = new MemoryDatabase();
const venueHolds = new VenueHoldFixture(database);
const getClient = () => database.client;
const access = createAuthorization({ resolvePrincipal: token => database.principal(token) });
const eventDependencies = { getPrincipal: access.getPrincipal, getAdminClient: getClient };
const availability = access.protectedRouter();
availability.get('/availability', access.requirePermission('venues.availability.view'), createAllVenuesAvailabilityHandler(undefined, getClient));
availability.get('/:venueId/availability', access.requirePermission('venues.availability.view'), createAvailabilityHandler(undefined, getClient));
const venues = createVenuesRouter(access, () => ({
  async list() {
    const result = await database.client.from('venues').select('*').order('name').order('venue_id');
    return result.data as VenueRecord[];
  },
  async save(values, id) {
    const table = database.client.from('venues');
    const query = id === undefined ? table.insert(values) : table.update(values).eq('venue_id', id);
    const result = await query.select('*').maybeSingle();
    return result.data as VenueRecord | null;
  }
}));
const layouts = createVenueLayoutsRouter(access, () => ({
  async list(venueId) {
    const result = await database.client.from('venue_layouts').select('layout,other_description').eq('venue_id', venueId).order('layout');
    return result.data as VenueLayoutRecord[];
  },
  async replace(venueId, values) {
    const venueResult = await database.client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    if (!venueResult.data) return null;
    await database.client.from('venue_layouts').delete().eq('venue_id', venueId);
    if (values.length === 0) return [];
    const rows = values.map(item => ({ venue_id: venueId, layout: item.layout, other_description: item.other_description ?? null }));
    const result = await database.client.from('venue_layouts').insert(rows).select('layout,other_description');
    return result.data as VenueLayoutRecord[];
  }
}));
// SG2-77: the memory adapter has no upsert, so save reads then inserts or updates.
const OPERATION_COLUMNS = 'setup_minutes,turnaround_minutes,emergency_access,known_restrictions,updated_at';
const operations = createVenueOperationsRouter(access, () => ({
  async get(venueId) {
    const venueResult = await database.client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    if (!venueResult.data) return null;
    const result = await database.client.from('venue_operations').select(OPERATION_COLUMNS).eq('venue_id', venueId).maybeSingle();
    return (result.data as VenueOperationRecord | null) ?? { ...DEFAULT_OPERATIONS };
  },
  async save(venueId, values) {
    const venueResult = await database.client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    if (!venueResult.data) return null;
    const row = { ...values, updated_at: new Date().toISOString() };
    const existing = await database.client.from('venue_operations').select('venue_id').eq('venue_id', venueId).maybeSingle();
    const table = database.client.from('venue_operations');
    const query = existing.data ? table.update(row).eq('venue_id', venueId) : table.insert({ venue_id: venueId, ...row });
    const result = await query.select(OPERATION_COLUMNS).maybeSingle();
    return result.data as VenueOperationRecord;
  }
}));
const BLOCK_COLUMNS = 'unavailability_id,starts_at,ends_at,reason';
const blocks = createVenueBlocksRouter(access, () => ({
  async list(venueId, now) {
    const result = await database.client.from('venue_unavailability').select(BLOCK_COLUMNS).eq('venue_id', venueId).gt('ends_at', now).order('starts_at');
    return result.data as VenueBlockRecord[];
  },
  async create(venueId, values) {
    const venueResult = await database.client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    if (!venueResult.data) return { outcome: 'missing' };
    const conflicts = await database.client.from('venue_bookings').select('booking_id,event_id,starts_at,ends_at')
      .eq('venue_id', venueId).eq('status', 'confirmed').lt('starts_at', values.ends_at).gt('ends_at', values.starts_at).order('starts_at').range(0, 0);
    const booking = (conflicts.data as BookingConflict[])[0];
    if (booking) return { outcome: 'conflict', booking };
    const result = await database.client.from('venue_unavailability').insert({ venue_id: venueId, ...values }).select(BLOCK_COLUMNS).maybeSingle();
    return { outcome: 'created', block: result.data as VenueBlockRecord };
  },
  async remove(venueId, blockId) {
    const result = await database.client.from('venue_unavailability').delete().eq('venue_id', venueId).eq('unavailability_id', blockId).select('unavailability_id');
    return (result.data as unknown[]).length > 0;
  }
}));
const rateLimiter =createLoginRateLimiter() as RequestHandler & { resetKey(key: string): void };
const app = createApp(
  async () => ({ provider: 'Supabase' as const, configured: false, supabase: { configured: false, status: 'unconfigured' as const } }),
  access,
  createEventDraftHandler(eventDependencies),
  createLoginHandler(input => loginAccount(input, getClient, token => database.principal(token))),
  createLogoutHandler(token => logoutAccount(token, getClient)),
  createUpdateRoleHandler(getClient),
  rateLimiter,
  submitEventRequestHandler(eventDependencies),
  getEventRequestsHandler(eventDependencies),
  createDeleteEventDraftHandler(eventDependencies),
  createUpdateEventDraftHandler(eventDependencies),
  getEventRequestDetailHandler(eventDependencies),
  { availability, venues, layouts, operations, blocks, search: createVenueSearchRouter(access, createVenueSearchHandler(undefined, getClient)), profile: createProfileRouter(access, { getAdminClient: getClient }),
    suitability: createVenueSuitabilityRouter(access, { getAdminClient: getClient }),
    bookingRequests: createBookingRequestSuitabilityRouter(access, { getAdminClient: getClient }),
    // SG2-48: venue requests, against the in-memory client.
    venueRequests: createVenueBookingRequestsRouter(access, { getAdminClient: getClient, decisions: createMemoryDecisionStore(database) }),
    // SG2-49: decision notices, against the in-memory client.
    notifications: createNotificationsRouter(access, memoryNotifications(database)) },
  createWorkQueueRouter(access, { getAdminClient: getClient }),
  // SG2-38's stage handler keeps its production default here, as it does on
  // main; only the review handler below needs the in-memory client.
  undefined,
  createStartEventReviewHandler(eventDependencies),
  // SG2-33/34: assignment, the assignable list and SG2-40's history run
  // against the in-memory client so the assignment history can be checked
  // end to end.
  createAssignCoordinatorHandler(eventDependencies),
  createDecideEventRequestHandler(eventDependencies),
  createListAssignableHandler({ getAdminClient: getClient }),
  // SG2-90: planning updates run against the in-memory client so a reassigned
  // coordinator's write can be refused end to end.
  createUpdateEventPlanningHandler(eventDependencies),
  createGetEventHistoryHandler(eventDependencies),
  // SG2-36's clarification exchange, against the in-memory client.
  createListClarificationsHandler(eventDependencies),
  createAddClarificationHandler(eventDependencies),
  createVenueHoldsRouter(access, venueHolds.store, () => venueHolds.now),
  // SG2-100 AC4: Mark Completed, against the in-memory client.
  createCompleteEventHandler(eventDependencies)
);

// Reset exists exclusively in this loopback test process. Fixtures are not
// mounted in production and no real service credentials are needed.
app.post('/__e2e/reset', (_req, res) => {
  database.reset();
  venueHolds.reset();
  rateLimiter.resetKey('127.0.0.1');
  rateLimiter.resetKey('::ffff:127.0.0.1');
  res.status(204).end();
});
app.get('/__e2e/ready', (_req, res) => res.json({ ready: true, storage: 'in-memory' }));
app.post('/__e2e/work-queue', (_req, res) => {
  database.seedWorkQueue();
  res.status(204).end();
});
app.post('/__e2e/assigned-review', (_req, res) => {
  database.seedAssignedReview();
  res.status(204).end();
});
app.post('/__e2e/venue-suitability', (_req, res) => {
  database.seedVenueSuitability();
  res.status(204).end();
});
app.post('/__e2e/venue-decision', (_req, res) => {
  database.seedVenueDecision();
  res.status(204).end();
});
app.post('/__e2e/venue-request', (_req, res) => {
  database.seedVenueRequest();
  res.status(204).end();
});
app.post('/__e2e/coordinator-assignment', (_req, res) => {
  database.seedCoordinatorAssignment();
  res.status(204).end();
});
app.post('/__e2e/coordinator-access', (_req, res) => {
  database.seedCoordinatorAccess();
  res.status(204).end();
});
app.post('/__e2e/legacy-assignment', (_req, res) => {
  database.seedLegacyAssignment();
  res.status(204).end();
});
app.post('/__e2e/under-review', (_req, res) => {
  database.seedUnderReview();
  res.status(204).end();
});
app.post('/__e2e/venue-holds', (_req, res) => {
  venueHolds.seed();
  res.status(204).end();
});
app.post('/__e2e/hold-time', (req, res) => {
  if (typeof req.body?.now !== 'string' || !venueHolds.advance(req.body.now)) { res.status(400).json({ error: 'Use a finite, nondecreasing fixture instant.' }); return; }
  res.status(204).end();
});
const buildDirectory = path.resolve(__dirname, '../client/dist');
app.use(express.static(buildDirectory));
app.get('*', (_req, res) => res.sendFile(path.join(buildDirectory, 'index.html')));
const server = app.listen(4173, '127.0.0.1', () => console.log('Regression server: http://127.0.0.1:4173 (in-memory fixtures)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
