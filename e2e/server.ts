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
import { createVenuesRouter } from '../server/src/venues';
import { createProfileRouter } from '../server/src/profile';
import { createAvailabilityHandler, createAllVenuesAvailabilityHandler } from '../server/src/venues/availability';
import type { VenueRecord } from '../server/src/venues/fields';
import { dbConfig } from '../server/src/db';
import { MemoryDatabase } from './support/memory-database';
import { createWorkQueueRouter } from '../server/src/workQueue';

// Application configuration may load a developer's .env during imports. Clear
// database configuration before serving any request, including health routes.
for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
for (const key of Object.keys(process.env)) if (key.startsWith('SUPABASE_')) delete process.env[key];
const database = new MemoryDatabase();
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
const rateLimiter = createLoginRateLimiter() as RequestHandler & { resetKey(key: string): void };
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
  { availability, venues, profile: createProfileRouter(access, { getAdminClient: getClient }) },
  createWorkQueueRouter(access, { getAdminClient: getClient }),
  // SG2-38's stage handler keeps its production default here, as it does on
  // main; only the review handler below needs the in-memory client.
  undefined,
  createStartEventReviewHandler(eventDependencies)
);

// Reset exists exclusively in this loopback test process. Fixtures are not
// mounted in production and no real service credentials are needed.
app.post('/__e2e/reset', (_req, res) => {
  database.reset();
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
const buildDirectory = path.resolve(__dirname, '../client/dist');
app.use(express.static(buildDirectory));
app.get('*', (_req, res) => res.sendFile(path.join(buildDirectory, 'index.html')));
const server = app.listen(4173, '127.0.0.1', () => console.log('Regression server: http://127.0.0.1:4173 (in-memory fixtures)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
