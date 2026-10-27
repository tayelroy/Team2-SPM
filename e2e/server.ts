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
import { createGetEventStageHandler } from '../server/src/events/getStage';
import { createGetEventArrangementsHandler } from '../server/src/events/getArrangements';
import { createAddClarificationHandler, createListClarificationsHandler } from '../server/src/events/clarifications';
import { createVenuesRouter } from '../server/src/venues';
import { createVenueLayoutsRouter } from '../server/src/venues/layouts';
import { createVenueOperationsRouter } from '../server/src/venues/operations';
import { DEFAULT_OPERATIONS, type VenueOperationRecord } from '../server/src/venues/operationFields';
import { createVenueBlocksRouter } from '../server/src/venues/blocks';
import { createVenueSearchHandler, createVenueSearchRouter } from '../server/src/venues/search';
import { createBookingRequestSuitabilityRouter, createVenueSuitabilityRouter } from '../server/src/venues/suitabilityRoutes';
import { createVenueBookingRequestsRouter } from '../server/src/venues/bookingRequests';
import { createVenueConflictsRouter } from '../server/src/venues/conflicts';
import { createNotificationsRouter } from '../server/src/notifications';
import { createMemoryDecisionStore, createMemoryWithdrawalStore, memoryNotifications } from './support/venue-decisions';
import { createMemoryReleaseStore } from './support/venue-releases';
import { createVenueBookingsRouter } from '../server/src/venues/bookings';
import { createVenueClashesRouter } from '../server/src/venues/clashes';
import { createProfileRouter } from '../server/src/profile';
import { createAvailabilityHandler, createAllVenuesAvailabilityHandler } from '../server/src/venues/availability';
import type { VenueRecord } from '../server/src/venues/fields';
import type { VenueLayoutRecord } from '../server/src/venues/layoutFields';
import type { AffectedBooking, VenueBlockRecord } from '../server/src/venues/blockFields';
import { dbConfig } from '../server/src/db';
import { MemoryDatabase } from './support/memory-database';
import { createWorkQueueRouter } from '../server/src/workQueue';
import { createVenueHoldsRouter } from '../server/src/venues/holds';
import { VenueHoldFixture } from './support/venue-holds';
import { createEquipmentRouter } from '../server/src/equipment';
import { createAssignmentQueueRouter } from '../server/src/assignmentQueue';
import { createCoordinatorOverviewRouter } from '../server/src/coordinatorOverview';
import { createMemoryEquipmentStore } from './support/equipment';
import { createEquipmentRequirementsRouter } from '../server/src/equipment/requirements';
import { createMemoryRequirementsStore } from './support/equipment-requirements';
import { createEquipmentAvailabilityRouter } from '../server/src/equipment/availability';
import { createMemoryAvailabilityStore } from './support/equipment-availability';
import { createEquipmentReservationsRouter } from '../server/src/equipment/reservations';
import { createMemoryReservationsStore, seedEquipmentReservations } from './support/equipment-reservations';
import { createConfirmEventHandler } from '../server/src/events/confirm';
import { createGetEventConfirmationHandler } from '../server/src/events/getConfirmation';
import { createMemoryConfirm, prepareConvertedForum, seedEventConfirmation } from './support/event-confirmation';
import { seedEventNotifications } from './support/event-notifications';
import { createMemoryNotificationInbox, seedNotificationInbox } from './support/notification-inbox';
import { createChangeRequestHandlers } from '../server/src/events/changeRequests';
import { createMockChangeRequestSource } from '../server/src/changeRequests/mockChangeRequests';
import { createMemoryChangeImpact, seedChangeImpact } from './support/change-impact';
import { createMemoryChangeRequests } from './support/change-requests';
import { createSafetyChecksRouter } from '../server/src/safetyChecks';
import { createMemorySafetyChecksStore, seedSafetyChecks } from './support/safety-checks';
import { createSafetyDecisionHandlers } from '../server/src/events/safetyDecisionRoutes';
import { changeReviewedDetail, createMemorySafetyDecisions, seedSafetyDecisions } from './support/safety-decisions';
import { createSafetyRereviewHandlers } from '../server/src/events/safetyRereviewRoutes';
import { createMemorySafetyRereviews } from './support/safety-rereviews';
import { seedSafetyApprovalGate } from './support/safety-approval';
import { createEventSearchRouter } from '../server/src/eventSearch';
import { createMemoryEventSearchStore, seedEventSearch } from './support/event-search';
import { createRegistrationHandlers } from '../server/src/events/registrationRoutes';
import { createMemoryRegistrations, seedRegistrations } from './support/registrations';
import { createRegistrableEventsRouter } from '../server/src/registrableEvents';
import { createMemoryRegistrableEventsStore, seedEventRegistration, seedRegistrableEvents } from './support/registrable-events';

// Application configuration may load a developer's .env during imports. Clear
// database configuration before serving any request, including health routes.
for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
for (const key of Object.keys(process.env)) if (key.startsWith('SUPABASE_')) delete process.env[key];
const database = new MemoryDatabase();
const venueHolds = new VenueHoldFixture(database);
const getClient = () => database.client;
const access = createAuthorization({ resolvePrincipal: token => database.principal(token) });
const eventDependencies = { getPrincipal: access.getPrincipal, getAdminClient: getClient };
// SG2-64: raised change requests over the in-memory tables; SG2-66's sample
// requests only on the events its fixture opts in. Reset with the database.
const changeRequests = createMemoryChangeRequests(database, createMockChangeRequestSource());
const availability = access.protectedRouter();
availability.get('/availability', access.requirePermission('venues.availability.view'), createAllVenuesAvailabilityHandler(undefined, getClient));
availability.get('/:venueId/availability', access.requirePermission('venues.availability.view'), createAvailabilityHandler(undefined, getClient));
const venues = createVenuesRouter(access, token => ({
  async list() {
    const result = await database.client.from('venues').select('*').is('deleted_at', null).order('name').order('venue_id');
    return result.data as VenueRecord[];
  },
  async save(values, id) {
    const table = database.client.from('venues');
    const query = id === undefined ? table.insert(values) : table.update(values).eq('venue_id', id).is('deleted_at', null);
    const result = await query.select('*').maybeSingle();
    return result.data as VenueRecord | null;
  },
  async remove(id) {
    return venueHolds.deleteVenue(id, (await database.principal(token)).userId);
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
    // SG2-79: introducing or changing times re-checks the venue's bookings.
    database.refreshVenueClashes(venueId);
    return result.data as VenueOperationRecord;
  }
}));
// SG2-80: mirrors list_venue_unavailability() and the flagging triggers over
// the in-memory tables: confirmed bookings inside a period are affected.
function venueBlocks(venueId: number, after: string): VenueBlockRecord[] {
  const { venue_unavailability: periods, venue_bookings: bookings, events, users } = database.tables;
  return periods.filter(row => row.venue_id === venueId && String(row.ends_at) > after)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .map(row => ({
      unavailability_id: row.unavailability_id, starts_at: row.starts_at, ends_at: row.ends_at,
      category: row.category ?? 'other', reason: row.reason, created_at: row.created_at ?? null,
      created_by_name: (users.find(user => user.user_id === row.created_by)?.name as string | undefined) ?? null,
      affected: bookings.filter(booking => booking.venue_id === venueId && booking.status === 'confirmed'
          && String(booking.starts_at) < String(row.ends_at) && String(booking.ends_at) > String(row.starts_at))
        .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
        .map(booking => {
          const event = events.find(item => item.event_id === booking.event_id);
          return { booking_id: booking.booking_id, event_id: booking.event_id ?? null, event_name: event?.name ?? null,
            event_status: event?.status ?? null, starts_at: booking.starts_at, ends_at: booking.ends_at } as AffectedBooking;
        })
    }) as VenueBlockRecord);
}
const blocks = createVenueBlocksRouter(access, token => ({
  async list(venueId, now) {
    return venueBlocks(venueId, now);
  },
  async create(venueId, values) {
    const venueResult = await database.client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    if (!venueResult.data) return { outcome: 'missing' };
    const { userId } = await database.principal(token);
    const result = await database.client.from('venue_unavailability')
      .insert({ venue_id: venueId, ...values, created_by: userId, created_at: new Date().toISOString() })
      .select('unavailability_id').maybeSingle();
    const id = (result.data as { unavailability_id: number }).unavailability_id;
    return { outcome: 'created', block: venueBlocks(venueId, values.starts_at).find(block => block.unavailability_id === id)! };
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
    // SG2-82: withdrawing a request, against the in-memory client.
    venueRequests: createVenueBookingRequestsRouter(access, { getAdminClient: getClient, decisions: createMemoryDecisionStore(database),
      withdrawals: createMemoryWithdrawalStore(database) }),
    // SG2-50: what a pending request overlaps, against the in-memory client.
    conflicts: createVenueConflictsRouter(access, { getAdminClient: getClient }),
    // SG2-49: decision notices, against the in-memory client.
    notifications: createNotificationsRouter(access, memoryNotifications(database), createMemoryNotificationInbox(database)) },
  createWorkQueueRouter(access, { getAdminClient: getClient }),
  // SG2-100: the stage tracker's own regression journey (SG2-100-P01) reads
  // this endpoint directly, so it now runs against the in-memory client too.
  createGetEventStageHandler(eventDependencies),
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
  createEquipmentRouter(access, () => createMemoryEquipmentStore(database)),
  createEquipmentRequirementsRouter(access, token => createMemoryRequirementsStore(database, token)),
  // SG2-100 AC4: Mark Completed, against the in-memory client.
  createCompleteEventHandler(eventDependencies),
  // SG2-87: the Lead's unassigned queue, against the in-memory client.
  createAssignmentQueueRouter(access, { getAdminClient: getClient }),
  // SG2-57: arrangement readiness, against the in-memory client so the
  // coordinator's event detail can load it without a 503.
  createGetEventArrangementsHandler(eventDependencies),
  // SG2-51: bookings and releases, against the in-memory client.
  createVenueBookingsRouter(access, { getAdminClient: getClient, releases: createMemoryReleaseStore(database) }),
  createEquipmentAvailabilityRouter(access, token => createMemoryAvailabilityStore(database, token)),
  createEquipmentReservationsRouter(access, token => createMemoryReservationsStore(database, token)),
  // SG2-79: clashing bookings, against the in-memory client.
  createVenueClashesRouter(access, { getAdminClient: getClient }),
  // SG2-58: confirmation mirrors confirm_event over the in-memory tables; the
  // confirmed-arrangements view reads them through the in-memory client.
  createConfirmEventHandler({ getPrincipal: access.getPrincipal, confirm: createMemoryConfirm(database) }),
  createGetEventConfirmationHandler(eventDependencies),
  // SG2-66: impact reads go through the in-memory client; acceptance and
  // settling mirror their SQL functions over the in-memory tables.
  createChangeRequestHandlers({
    ...eventDependencies, source: changeRequests.source, raise: changeRequests.raise, ...createMemoryChangeImpact(database)
  }),
  // SG2-91: the Safety Officer's list mirrors safety_check_queue over the
  // in-memory tables.
  createSafetyChecksRouter(access, token => createMemorySafetyChecksStore(database, token)),
  // SG2-92: the decision history reads the in-memory client; recording and
  // reworking mirror their SQL functions over the in-memory tables. SG2-93
  // adds the requests a Request Changes sent back to staff.
  createSafetyDecisionHandlers({ ...eventDependencies, ...createMemorySafetyDecisions(database),
    listRereviews: createMemorySafetyRereviews(database).listRereviews }),
  // SG2-70: event search mirrors search_events over the in-memory tables.
  createEventSearchRouter(access, token => createMemoryEventSearchStore(database, token)),
  // SG2-63: the registration picture and settings mirror their SQL functions
  // over the in-memory tables.
  createRegistrationHandlers({ ...eventDependencies, ...createMemoryRegistrations(database) }),
  // SG2-59: the attendee's event list mirrors registrable_events over the in-memory tables.
  createRegistrableEventsRouter(access, token => createMemoryRegistrableEventsStore(database, token)),
  // SG2-67: cancellation keeps its default handlers, as before.
  undefined,
  // SG2-89: the Lead's overview, against the in-memory client.
  createCoordinatorOverviewRouter(access, { getAdminClient: getClient }),
  // SG2-93: the staff side, mirroring the SQL functions in memory.
  createSafetyRereviewHandlers({ getPrincipal: access.getPrincipal, getAdminClient: getClient, ...createMemorySafetyRereviews(database) })
);

// Reset exists exclusively in this loopback test process. Fixtures are not
// mounted in production and no real service credentials are needed.
app.post('/__e2e/reset', (_req, res) => {
  database.reset();
  venueHolds.reset();
  changeRequests.reset();
  rateLimiter.resetKey('127.0.0.1');
  rateLimiter.resetKey('::ffff:127.0.0.1');
  res.status(204).end();
});
app.get('/__e2e/ready', (_req, res) => res.json({ ready: true, storage: 'in-memory' }));
// SG2-96: the whole Week 7 journey needs the database's safety-check hand-off.
app.post('/__e2e/safety-handoff', (_req, res) => {
  database.safetyHandoff = true;
  res.sendStatus(204);
});
app.get('/__e2e/journey-ledger', (req, res) => {
  const ids = database.tables.events.filter(row => row.name === req.query.name).map(row => row.event_id);
  const mine = (row: Record<string, unknown>) => ids.includes(row.event_id);
  res.json({
    events: database.tables.events.filter(mine), audit: database.tables.event_audit_logs.filter(mine),
    notifications: database.tables.notifications.filter(mine), decisions: (database.tables.event_safety_decisions ?? []).filter(mine),
    venue_requests: database.tables.venue_booking_requests.filter(mine), bookings: database.tables.venue_bookings.filter(mine),
    equipment_requests: database.tables.equipment_requests.filter(mine), reservations: database.tables.equipment_reservations.filter(mine),
  });
});
app.post('/__e2e/work-queue', (_req, res) => {
  database.seedWorkQueue();
  res.status(204).end();
});
app.post('/__e2e/equipment-reservations', (req, res) => {
  seedEquipmentReservations(database, Boolean(req.body?.missing_dates));
  res.status(204).end();
});
app.get('/__e2e/equipment-reservations-ledger', (_req, res) => res.json({
  requests: database.tables.equipment_requests, reservations: database.tables.equipment_reservations, notifications: database.tables.notifications,
}));
app.post('/__e2e/event-confirmation', (_req, res) => {
  seedEventConfirmation(database);
  res.status(204).end();
});
// SG2-66: a Confirmed event whose sample attendance change outgrows its venue.
app.post('/__e2e/change-impact', (_req, res) => {
  seedChangeImpact(database);
  changeRequests.useSamplesFor(661);
  res.status(204).end();
});
app.get('/__e2e/change-impact-ledger', (_req, res) => res.json({
  events: database.tables.events.filter(row => row.event_id === 661),
  audit: database.tables.event_audit_logs.filter(row => row.event_id === 661),
  notifications: database.tables.notifications.filter(row => row.event_id === 661),
}));
// SG2-92: three events awaiting the Safety Officer's check.
app.post('/__e2e/safety-decisions', (_req, res) => {
  seedSafetyDecisions(database);
  res.status(204).end();
});
// SG2-92: a reviewed detail of one seeded event changes, as SG2-91's trigger
// records by moving its safety_check_revision on.
app.post('/__e2e/safety-decisions-change/:eventId', (req, res) => {
  changeReviewedDetail(database, Number(req.params.eventId));
  res.status(204).end();
});
app.get('/__e2e/safety-decisions-ledger', (_req, res) => {
  const seeded = (row: Record<string, unknown>) => [921, 922, 923].includes(Number(row.event_id));
  res.json({
    events: database.tables.events.filter(seeded), decisions: database.tables.event_safety_decisions,
    audit: database.tables.event_audit_logs.filter(seeded), notifications: database.tables.notifications.filter(seeded),
    // SG2-93: the requests a Request Changes sent back to staff.
    rereviews: database.tables.safety_rereviews.filter(seeded),
  });
});
// SG2-94: one event awaiting its check, and one approved event in Preparation.
app.post('/__e2e/safety-approval', (_req, res) => {
  seedSafetyApprovalGate(database);
  changeRequests.useSamplesFor(941);
  changeRequests.useSamplesFor(942);
  res.status(204).end();
});
app.get('/__e2e/safety-approval-ledger', (_req, res) => {
  const seeded = (row: Record<string, unknown>) => [941, 942].includes(Number(row.event_id));
  res.json({
    events: database.tables.events.filter(seeded), decisions: database.tables.event_safety_decisions.filter(seeded),
    audit: database.tables.event_audit_logs.filter(seeded), notifications: database.tables.notifications.filter(seeded),
  });
});
// SG2-63: a confirmed event with open registration, two registered and one withdrawn.
app.post('/__e2e/registrations', (_req, res) => {
  seedRegistrations(database);
  res.status(204).end();
});
app.get('/__e2e/registrations-ledger', (_req, res) => res.json({
  event: database.tables.events.find(row => row.event_id === 631),
  audit: database.tables.event_audit_logs.filter(row => row.event_id === 631),
  notifications: database.tables.notifications.filter(row => row.event_id === 631),
}));
app.post('/__e2e/event-confirmation-prepare', (_req, res) => {
  prepareConvertedForum(database);
  res.status(204).end();
});
app.get('/__e2e/event-confirmation-ledger', (_req, res) => {
  const seeded = (row: Record<string, unknown>) => [581, 582, 583, 584, 585].includes(Number(row.event_id));
  res.json({
    events: database.tables.events.filter(seeded), audit: database.tables.event_audit_logs, notifications: database.tables.notifications,
    venue_requests: database.tables.venue_booking_requests.filter(seeded), holds: database.tables.venue_holds.filter(seeded),
    bookings: database.tables.venue_bookings.filter(seeded),
  });
});
// SG2-59: events an attendee can and cannot find.
app.post('/__e2e/registrable-events', (_req, res) => {
  seedRegistrableEvents(database);
  res.status(204).end();
});
// SG2-60: SG2-59's events plus one whose only place is taken.
app.post('/__e2e/event-registration', (_req, res) => {
  seedRegistrableEvents(database);
  seedEventRegistration(database);
  res.status(204).end();
});
// SG2-60: the registrations and confirmations the loopback app now holds.
app.get('/__e2e/event-registration-ledger', (_req, res) => {
  res.json({
    registrations: database.tables.registrations.filter(row => [591, 592, 596].includes(Number(row.event_id))),
    notifications: database.tables.notifications.filter(row => row.kind === 'registration_confirmed'),
  });
});
// SG2-70: events across organisations to search for, plus a draft that is never found.
app.post('/__e2e/event-search', (_req, res) => {
  seedEventSearch(database);
  res.status(204).end();
});
app.post('/__e2e/safety-checks', (_req, res) => {
  seedSafetyChecks(database);
  res.status(204).end();
});
app.post('/__e2e/event-notifications', (_req, res) => {
  seedEventNotifications(database);
  res.status(204).end();
});
app.post('/__e2e/notification-inbox', (req, res) => {
  const unreadCount = req.body?.unreadCount;
  if (unreadCount !== undefined && (!Number.isInteger(unreadCount) || unreadCount < 2 || unreadCount > 1000)) {
    res.status(400).json({ error: 'Unread fixture count must be a whole number from 2 through 1000.' });
    return;
  }
  seedNotificationInbox(database, req.body?.large === true, req.body?.multiRole === true, unreadCount);
  res.status(204).end();
});
app.get('/__e2e/notification-inbox-ledger', (_req, res) => res.json({
  notifications: database.tables.notifications, holds: database.tables.venue_hold_notifications,
  preferences: database.tables.notification_reminder_preferences,
}));
// SG2-68: every stored notice with its recipient, which the bell never shows.
app.get('/__e2e/event-notifications-ledger', (_req, res) => res.json({
  notifications: database.tables.notifications, events: database.tables.events.filter(row => [681, 682, 683].includes(Number(row.event_id))),
}));
app.post('/__e2e/equipment-requirements', (_req, res) => {
  database.tables.events.push({ ...database.tables.events[0], event_id: 53, name: 'Equipment Requirements Forum',
    coordinator_id: 'user-coordinator', status: 'approved', proposed_date: '2030-06-20T02:00:00.000Z' });
  database.tables.equipment.push({ equipment_id: 2, name: 'Portable projector', description: 'HDMI projector',
    quantity_total: 2, location: 'Store B', operational_status: 'maintenance', version: 1 });
  res.status(204).end();
});
app.post('/__e2e/equipment-availability', (req, res) => {
  const base = database.tables.events[0];
  const start = '2030-06-20T02:00:00.000Z', end = '2030-06-20T06:00:00.000Z';
  database.tables.events.push({ ...base, event_id: 54, name: 'Equipment Availability Forum',
    coordinator_id: 'user-coordinator', status: req.body?.confirmed ? 'confirmed' : 'approved', proposed_date: start });
  for (const event_id of [541, 542, 543, 544, 545]) database.tables.events.push({ ...base, event_id,
    name: `Reservation fixture ${event_id}`, status: event_id === 545 ? 'cancelled' : 'confirmed' });
  database.tables.equipment.push(
    { equipment_id: 2, name: 'Maintenance projector', description: 'Projector', quantity_total: 5, location: 'Store B', operational_status: 'maintenance', version: 1 },
    { equipment_id: 3, name: 'Damaged speakers', description: 'Speakers', quantity_total: 7, location: 'Store C', operational_status: 'damaged', version: 1 });
  for (const [request_id, equipment_id, quantity] of [[1, 1, 10], [2, 2, 3], [3, 3, 2]]) {
    database.tables.equipment_requests.push({ request_id, event_id: 54, equipment_id, quantity, notes: null, status: 'pending',
      starts_at: req.body?.request_dates ? start : null, ends_at: req.body?.request_dates ? end : null,
      arrangement_notes: null, shortfall: null, placement_venue_id: null, placement_position: null, version: 1 });
  }
  if (!req.body?.missing_dates) database.tables.venue_bookings.push({ booking_id: 540, venue_id: 1, event_id: 54, starts_at: start, ends_at: end, status: 'confirmed' });
  database.tables.equipment_reservations = [
    { reservation_id: 1, event_id: 541, equipment_id: 1, quantity_reserved: 8, starts_at: start, ends_at: '2030-06-20T04:00:00.000Z' },
    { reservation_id: 2, event_id: 542, equipment_id: 1, quantity_reserved: 6, starts_at: '2030-06-20T03:00:00.000Z', ends_at: '2030-06-20T05:00:00.000Z' },
    { reservation_id: 3, event_id: 543, equipment_id: 1, quantity_reserved: 14, starts_at: '2030-06-20T05:00:00.000Z', ends_at: end },
    { reservation_id: 4, event_id: 54, equipment_id: 1, quantity_reserved: 2, starts_at: start, ends_at: end },
    { reservation_id: 5, event_id: 545, equipment_id: 1, quantity_reserved: 99, starts_at: start, ends_at: end },
  ];
  if (req.body?.undated) database.tables.equipment_reservations.push({ reservation_id: 6, event_id: 544, equipment_id: 1, quantity_reserved: 3 });
  res.status(204).end();
});
app.post('/__e2e/equipment-availability-change', (_req, res) => {
  database.tables.equipment_reservations.find(row => row.reservation_id === 3)!.quantity_reserved = 18;
  res.status(204).end();
});
app.get('/__e2e/equipment-availability-ledger', (_req, res) => res.json({
  requests: database.tables.equipment_requests, reservations: database.tables.equipment_reservations, equipment: database.tables.equipment,
}));
app.post('/__e2e/assigned-review', (_req, res) => {
  database.seedAssignedReview();
  res.status(204).end();
});
app.post('/__e2e/venue-suitability', (_req, res) => {
  database.seedVenueSuitability();
  res.status(204).end();
});
app.post('/__e2e/capacity-exceptions', (_req, res) => {
  database.seedCapacityExceptions();
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
app.post('/__e2e/venue-multiple', (_req, res) => {
  database.seedVenueMultiple();
  res.status(204).end();
});
app.post('/__e2e/venue-release', (_req, res) => {
  database.seedVenueRelease();
  res.status(204).end();
});
// SG2-83: the released-venue event plus a free venue to change one booking to.
app.post('/__e2e/venue-change', (_req, res) => {
  database.seedVenueChange();
  res.status(204).end();
});
// SG2-104: the default preserves the original Venue Staff + Coordinator case.
// SG2-96 also checks the other shared staging-account combinations on phones.
app.post('/__e2e/multi-role', (req, res) => {
  const combinations: Record<string, { user_id: string; role: string }> = {
    'venue-coordinator': { user_id: 'user-venue', role: 'event_coordinator' },
    'coordinator-attendee': { user_id: 'user-coordinator', role: 'attendee' },
    'organiser-coordinator': { user_id: 'user-organiser', role: 'event_coordinator' },
  };
  const combination = combinations[String(req.body?.combination ?? 'venue-coordinator')];
  if (!combination) { res.status(400).json({ error: 'Unknown multi-role fixture combination.' }); return; }
  database.tables.account_roles.push(combination);
  res.status(204).end();
});
app.post('/__e2e/venue-clash', (_req, res) => {
  database.seedVenueClash();
  res.status(204).end();
});
// SG2-98 AC3: a block recorded under SG2-45 as the SG2-80 upgrade leaves it,
// filed under 'other' with no recorder or time.
app.post('/__e2e/legacy-venue-block', (_req, res) => {
  database.tables.venue_unavailability.push({ unavailability_id: 98, venue_id: 1, starts_at: '2030-06-18T00:00:00.000Z',
    ends_at: '2030-06-19T00:00:00.000Z', category: 'other', reason: 'Roof repair', created_by: null, created_at: null });
  res.status(204).end();
});
app.post('/__e2e/coordinator-assignment', (_req, res) => {
  database.seedCoordinatorAssignment();
  res.status(204).end();
});
// SG2-89: two Leads, the events each supervises, and a shared queue entry.
app.post('/__e2e/coordinator-oversight', (_req, res) => {
  database.seedCoordinatorOversight();
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
app.post('/__e2e/lifecycle', (_req, res) => {
  database.seedLifecycle();
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
const fixturePort = Number(process.env.E2E_PORT ?? 4173);
const server = app.listen(fixturePort, '127.0.0.1', () => console.log(`Regression server: http://127.0.0.1:${fixturePort} (in-memory fixtures)`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
