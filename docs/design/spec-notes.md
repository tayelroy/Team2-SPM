# Spec docs — sources (SG2-95)

As of main 1d1e336 (14 Oct 2026). Files: `api-specification.md`, `architectural-decisions.md`.

## api-specification.md
- Mounts and order: `server/src/app.ts:123-320`.
- Permissions and roles: `server/src/auth/policy.ts` (`PERMISSIONS`). Middleware: `server/src/auth/index.ts` (`requireAuth`, `requirePermission`, `protectedRouter`).
- §3 Auth and profile: `auth/login.ts`, `auth/logout.ts`, `auth/roles.ts`, `profile/index.ts`, `profile/fields.ts`.
- §4 Event requests:
  - handlers: `events/*.ts`
  - validation: `events/fields.ts`
  - record shapes and guarded writes: `db/eventRequests.ts`
  - history: `db/auditLogs.ts`
  - notices: `db/eventNotifications.ts`
  - `confirm_event`: `202610150003_confirm_event_rejected_venues.sql`
- §5 Queues and notifications: `assignmentQueue/index.ts` + `db/assignmentQueue.ts`; `workQueue/index.ts` + `db/workQueue.ts`; `notifications/index.ts` + `db/notifications.ts`.
- §6 Venues: `venues/{index,fields,layouts,layoutFields,operations,operationFields,availability,preparation,search,searchFields,suitabilityRoutes,blocks,blockFields}.ts`. Unavailability RPC and triggers: `202610100001_venue_temporary_unavailability.sql`.
- §7 Booking requests:
  - routes and validation: `venues/{bookingRequests,bookingRequestFields,conflicts}.ts`
  - db: `db/venueBookingRequests.ts`, `db/venueConflicts.ts`, `db/venueBookingDecisions.ts`, `db/venueBookingWithdrawals.ts`
  - RPCs: `decide_venue_booking_request` (latest `202610160001_event_notifications.sql`), `withdraw_venue_booking_request` (`202610150002`)
- §8 Holds, bookings and clashes:
  - routes: `venues/{holds,holdFields,bookings,clashes}.ts`
  - RPCs: `202610050001_venue_holds.sql`, `202610120002_setup_turnaround_checks.sql`, `202610100002_venue_booking_release.sql`, `202610140003_venue_booking_clashes.sql`
- §9 Equipment:
  - routes: `equipment/{index,fields,requirements,availability,reservations}.ts`
  - RPCs: `202610140002_equipment_reserved_shortfall.sql`, `202610120001_equipment_availability.sql`, `202610140001_equipment_reservations.sql`
- Week 7 markers: story tags in route and handler comments, plus `git log --diff-filter=A` dates of the router files. Week 7 started 2026-10-05 (first merge: SG2-84/85).
- Route-set check: regex over `app.ts` and router files, compared with the §2 index (73 = 73, no differences).

## architectural-decisions.md

| Section | Sources |
|---|---|
| ADR-01 | `server/vercel.json`, `server/package.json` (build), `app.ts:110-118`, `README.md` |
| ADR-02 | `auth/{index,policy,supabase}.ts`, `db/user-client.ts`, `db/supabase.ts` (`getSupabaseAdminClient`), `docs/authorization.md`, `202610070002_legacy_table_rls.sql`, `202610130001_event_history_internal_fields.sql` |
| ADR-03 | `for update` / `security definer` in the migrations listed in §7–§9; `202610070003_venue_double_booking.sql` |
| ADR-04 | `db/eventRequests.ts`, `db/equipment.ts` |
| ADR-05 | `client/src/venues/searchApi.ts` (`sgtToIso`, `formatSgt`), `client/src/screens/{WorkQueue,VenueHolds,RequestForm}.tsx`, `client/src/venues/blocksApi.ts`, `venues/holdFields.ts` |
| ADR-06 | `db/auditLogs.ts`, `events/getHistory.ts`, `202609240000_event_planning_and_audit.sql`, `202610050003_venue_operations.sql` |
| ADR-07 | `202610060001_venue_booking_decisions.sql` (table and policy), `202610160001_event_notifications.sql`, `db/eventNotifications.ts`, `docs/notifications.md`, `docs/venue-holds.md` |
| ADR-08 | `202610050001_venue_holds.sql:126-150,302-312` |
| Change log | Migration headers (`202610050003`, `202610050004`, `202610090001`, `202610100001`, `202610140003`, `202610150002`), `git log` story commits, the SG2-95 brief (Jira status) |
| Known limits | `events/{submit,decide,clarifications,updatePlanning,assignCoordinator,complete}.ts`, `db/eventRequests.ts:420-440`, `db/venueLayouts.ts:47-52`, `events/fields.ts` (`STATUS_TRANSITIONS`) |
