# Spec docs — sources (SG2-95)

Revision note: the original 14 Oct design described main `1d1e336`. This revision describes PR90 head `61416cc`, including merged PR92; it does not claim that PR90 is merged or that every Done criterion has passed hosted acceptance. Jira status was refreshed on 16 Oct 2026.

Baseline PR90 head 61416cc, extended by the local SG2-46/47/40 corrections (16 Oct 2026). Files: `api-specification.md`, `architectural-decisions.md`.

## api-specification.md
- Mounts and order: `server/src/app.ts:123-320`.
- Permissions and roles: `server/src/auth/policy.ts` (`PERMISSIONS`). Middleware: `server/src/auth/index.ts` (`requireAuth`, `requirePermission`, `protectedRouter`).
- §3 Auth and profile: `auth/login.ts`, `auth/logout.ts`, `auth/roles.ts`, `profile/index.ts`, `profile/fields.ts`.
- §4 Event requests:
  - handlers: `events/*.ts`
  - validation: `events/fields.ts`
  - record shapes and guarded writes: `db/eventRequests.ts`
  - history: `db/auditLogs.ts`; atomic creator draft/clarification saves use `update_event_request_draft` in `202610170003_event_draft_change_history.sql` through `db/eventRequests.ts`. The existing PATCH response and 74-pair / 71-registration API count remain unchanged.
  - notices: `db/eventNotifications.ts`
  - `confirm_event`: `202610170002_confirmation_rechecks_and_disruptions.sql`
- §5 Queues and notifications: `assignmentQueue/index.ts` + `db/assignmentQueue.ts`; `workQueue/index.ts` + `db/workQueue.ts`; `notifications/index.ts` + `db/notifications.ts`.
- §6 Venues: `venues/{index,fields,layouts,layoutFields,operations,operationFields,availability,preparation,search,searchFields,suitabilityRoutes,blocks,blockFields}.ts`. Unavailability RPC and triggers: `202610100001_venue_temporary_unavailability.sql`.
- §7 Booking requests:
  - routes and validation: `venues/{bookingRequests,bookingRequestFields,conflicts}.ts`
  - db: `db/venueBookingRequests.ts`, `db/venueConflicts.ts`, `db/venueBookingDecisions.ts`, `db/venueBookingWithdrawals.ts`
  - RPCs: `decide_venue_booking_request` (latest `202610170001_venue_replacement.sql`), `withdraw_venue_booking_request` (`202610150002`)
- §8 Holds, bookings and clashes:
  - routes: `venues/{holds,holdFields,bookings,clashes}.ts`
  - RPCs: `202610050001_venue_holds.sql`, `202610120002_setup_turnaround_checks.sql`, `202610100002_venue_booking_release.sql`, `202610140003_venue_booking_clashes.sql`
- §9 Equipment:
  - routes: `equipment/{index,fields,requirements,availability,reservations}.ts`
  - RPCs: `202610140002_equipment_reserved_shortfall.sql`, `202610120001_equipment_availability.sql`, `202610140001_equipment_reservations.sql`
- Week 7 markers: story tags in route and handler comments, plus `git log --diff-filter=A` dates of the router files. Week 7 started 2026-10-05 (first merge: SG2-84/85).
- SG2-81 changes existing request/decision contracts, adds `replaces_booking_id`, booking `affected_by` / pending `replacement`, disruption counts in readiness, and `venue_unavailable` notifications. No replacement endpoint is invented. Sources: `db/venueDisruptions.ts`, `db/venueBookings.ts`, `venues/bookingRequests.ts`, migration `202610170001`; final confirmation combines those checks with persisted planning flags in `202610170002`.
- Historical route-set check: baseline code and index matched 73 pairs. The capacity revision adds one explicit GET registration (`venues/suitabilityRoutes.ts`) under the existing booking-request mount: current catalogue 74 unique pairs / 71 registrations. Original 73 index rows are preserved.
- SG2-47 discovery: `db/venueSuitability.ts` uses named joins and ordered 1,000-row batches; creator scope is enforced in both database query and handler. `client/src/screens/CapacityExceptions.tsx` supplies Organiser/TSS navigation to the existing suitability and approval routes. No DDL or permission expansion; the exception remains distinct from Venue Staff booking approval.

## architectural-decisions.md

| Section | Sources |
|---|---|
| ADR-01 | `server/vercel.json`, `server/package.json` (build), `app.ts:110-118`, `README.md` |
| ADR-02 | `auth/{index,policy,supabase}.ts`, `db/user-client.ts`, `db/supabase.ts` (`getSupabaseAdminClient`), `docs/authorization.md`, `202610070002_legacy_table_rls.sql`, `202610130001_event_history_internal_fields.sql` |
| ADR-03 | `for update` / `security definer` in the migrations listed in §7–§9; `202610070003_venue_double_booking.sql` |
| ADR-04 | `db/eventRequests.ts`, `db/equipment.ts` |
| ADR-05 | `client/src/venues/searchApi.ts` (`sgtToIso`, `formatSgt`), `client/src/screens/{WorkQueue,VenueHolds,RequestForm}.tsx`, `client/src/venues/blocksApi.ts`, `venues/holdFields.ts` |
| ADR-06 | `db/auditLogs.ts`, `events/getHistory.ts`, `events/updateDraft.ts`, `db/eventRequests.ts`, `202609240000_event_planning_and_audit.sql`, `202610170003_event_draft_change_history.sql`, `202610050003_venue_operations.sql` |
| ADR-07 | `202610060001_venue_booking_decisions.sql` (table and policy), `202610160001_event_notifications.sql`, `db/eventNotifications.ts`, `docs/notifications.md`, `docs/venue-holds.md` |
| ADR-08 | `202610050001_venue_holds.sql:126-150,302-312` |
| Current replacement/confirmation revision | `202610170001_venue_replacement.sql`, `202610170002_confirmation_rechecks_and_disruptions.sql`, `202610160005_event_confirmation_record_repair.sql`; fresh Jira Done export 16 Oct 2026 |
| Change log | Migration headers (`202610050003`, `202610050004`, `202610090001`, `202610100001`, `202610140003`, `202610150002`), `git log` story commits, the SG2-95 brief (Jira status) |
| Known limits | `events/{submit,decide,clarifications,updatePlanning,assignCoordinator,complete}.ts`, `db/eventRequests.ts:420-440`, `db/venueLayouts.ts:47-52`, `events/fields.ts` (`STATUS_TRANSITIONS`) |
