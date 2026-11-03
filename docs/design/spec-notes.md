# Spec docs — sources (SG2-95)

Revision note: the original 14 Oct design described main `1d1e336`; the 16 Oct revision described PR90 head `61416cc`. This revision describes main `4881413` (3 Nov 2026), after all 23 Sprint 4 stories merged; it does not claim that every Done criterion has passed hosted acceptance.

Baseline main 4881413 (3 Nov 2026). Files: `api-specification.md`, `architectural-decisions.md`. Section numbers below are those of `api-specification.md` at this revision.

## api-specification.md
- Mounts and order: `server/src/app.ts:147-398` (mounts, with the event-request routes at `app.ts:204-390`); health checks follow at `app.ts:401-`.
- Permissions and roles: `server/src/auth/policy.ts` (`PERMISSIONS`). Middleware: `server/src/auth/index.ts` (`requireAuth`, `requirePermission`, `protectedRouter`). Acting role (SG2-104): `server/src/auth/actingRole.ts`.
- §3 Auth and profile: `auth/login.ts`, `auth/logout.ts`, `auth/roles.ts`, `auth/index.ts` (`GET /api/auth/me`), `profile/index.ts`, `profile/fields.ts`.
- §4 Event requests:
  - handlers: `events/*.ts` (incl. `cancellation.ts`, `changeRequests.ts`, `changeImpact.ts`, `registrationRoutes.ts`, `safetyDecisionRoutes.ts`, `safetyRereviewRoutes.ts`)
  - validation: `events/fields.ts`
  - record shapes and guarded writes: `db/eventRequests.ts`, `db/eventPlanning.ts`
  - history: `db/auditLogs.ts`; atomic creator draft/clarification saves use `update_event_request_draft` in `202610170003_event_draft_change_history.sql` through `db/eventRequests.ts`
  - notices: `db/eventNotifications.ts`
  - `confirm_event`: latest body `202610290001_requested_equipment_outstanding.sql` (earlier `202610220001_safety_approval_gate.sql`, `202610170002_confirmation_rechecks_and_disruptions.sql`); adapter `db/eventConfirmation.ts`
  - cancellation (§4.20–4.21): `db/eventCancellation.ts`, `202610220002_event_cancellation.sql`
  - change requests and rechecks (§4.22–4.25): `db/changeRequests.ts`, `db/changeImpact.ts`, `202610190003_event_change_impact.sql`, `202610260001_event_change_requests.sql`, `202610270001_change_request_decisions.sql`
  - safety decisions and rework (§4.26–4.28): `db/safetyDecisions.ts`, `202610190005_safety_decisions.sql`, `202610190006_safety_decision_revision.sql`, `202610240001_safety_changes_requested.sql`, `202610290002_safety_rework_resubmit.sql`
  - registration picture and settings (§4.13a): `db/registrations.ts`, `202610200004_event_registration_settings.sql`
- §5 Queues and notifications: `assignmentQueue/index.ts` + `db/assignmentQueue.ts`; `workQueue/index.ts` + `db/workQueue.ts`; `notifications/index.ts` + `db/notifications.ts` + `db/notificationInbox.ts` (inbox and reminders: `202610200003_notifications_inbox_reminders.sql`); `coordinatorOverview/index.ts` + `db/coordinatorOverview.ts` (`202610220004_coordinator_oversight.sql`); `safetyChecks/index.ts` + `db/safetyChecks.ts` (`202610190004_safety_check_queue.sql`); safety re-reviews `events/safetyRereviewRoutes.ts` + `db/safetyRereviews.ts` (`202610240001`).
- §6 Venues: `venues/{index,fields,layouts,layoutFields,operations,operationFields,availability,preparation,search,searchFields,suitabilityRoutes,blocks,blockFields}.ts`. Unavailability RPC and triggers: `202610100001_venue_temporary_unavailability.sql`. Venue delete (§6.3a): `venues/index.ts`, `202610170007_venue_delete_hold_expiry.sql`, `202610190001_venue_delete_past_holds.sql`.
- §7 Booking requests:
  - routes and validation: `venues/{bookingRequests,bookingRequestFields,conflicts,suitabilityRoutes}.ts`
  - db: `db/venueBookingRequests.ts`, `db/venueConflicts.ts`, `db/venueBookingDecisions.ts`, `db/venueBookingWithdrawals.ts`, `db/venueSuitability.ts`
  - RPCs: `decide_venue_booking_request` (latest `202610200002_acting_role_functions.sql`), `withdraw_venue_booking_request` (`202610150002`)
  - capacity exceptions (§7.7–7.8): `202610190002_venue_staff_capacity_exceptions.sql`
- §8 Holds, bookings and clashes:
  - routes: `venues/{holds,holdFields,bookings,clashes}.ts`
  - RPCs: `202610050001_venue_holds.sql`, `202610120002_setup_turnaround_checks.sql`, `202610170007_venue_delete_hold_expiry.sql` (`change_venue_hold_expiry`), `202610190002_venue_staff_capacity_exceptions.sql` (`change_venue_hold`), `202610140003_venue_booking_clashes.sql`
  - booking release (§8.8): `release_venue_bookings` in `202610210002_venue_booking_change_cancel.sql`; adapter `db/venueBookings.ts`
- §9 Equipment:
  - routes: `equipment/{index,fields,requirements,availability,reservations}.ts`
  - RPCs: `202610140002_equipment_reserved_shortfall.sql`, `202610120001_equipment_availability.sql`, `202610140001_equipment_reservations.sql`, `202610210001_equipment_release.sql` (release on cancellation)
- §9A Event search (SG2-70): `eventSearch/index.ts`, `db/eventSearch.ts`, `202610200005_event_search.sql`, `202610260002_event_lookup_indexes.sql`.
- §9B Events open for registration: `registrableEvents/{index,registration}.ts`, `db/registrableEvents.ts`, `myRegistrations/index.ts`, `db/myRegistrations.ts`; RPCs `202610220003_registrable_events.sql`, `202610230001_event_registration.sql`, `202610260003_registration_withdrawal.sql`, `202610280001_waiting_list.sql`.
- Week 7 markers: story tags in route and handler comments, plus `git log --diff-filter=A` dates of the router files. Week 7 started 2026-10-05 (first merge: SG2-84/85).
- SG2-81 changes existing request/decision contracts, adds `replaces_booking_id`, booking `affected_by` / pending `replacement`, disruption counts in readiness, and `venue_unavailable` notifications. No replacement endpoint is invented. Sources: `db/venueDisruptions.ts`, `db/venueBookings.ts`, `venues/bookingRequests.ts`, migration `202610170001`. SG2-83 reuses that request path with `change_reason` (`202610210002`); final confirmation combines the disruption checks with persisted planning flags and the safety approval (`202610170002`, `202610220001`, latest `202610290001`).
- Route-set check: `server/src` registers 105 routes (a grep over the router and `app` method calls, excluding tests), which `api-specification.md` §13 expands to 108 method + path pairs. The 16 Oct figure (74 pairs / 71 registrations) is superseded.
- SG2-47 discovery (16 Oct baseline): `db/venueSuitability.ts` uses named joins and ordered 1,000-row batches; creator scope is enforced in both database query and handler. `client/src/screens/CapacityExceptions.tsx` supplies Organiser/TSS navigation to the existing suitability and approval routes. Since SG2-66 AC5 (`202610190002_venue_staff_capacity_exceptions.sql`) only Venue Staff record an exception (`venue_booking.capacity_exception.approve` in `policy.ts`); earlier approvals by other roles are kept as inert history.

## architectural-decisions.md

| Section | Sources |
|---|---|
| ADR-01 | `server/vercel.json`, `server/package.json` (build), `app.ts:145` (`trust proxy`), `README.md` |
| ADR-02 | `auth/{index,policy,supabase}.ts`, `db/user-client.ts`, `db/supabase.ts` (`getSupabaseAdminClient`), `docs/authorization.md`, `202610070002_legacy_table_rls.sql`, `202610130001_event_history_internal_fields.sql` |
| ADR-03 | `for update` / `security definer` in the migrations listed in §7–§9 and §4.20–§4.28 (incl. `202610220002`, `202610280001`); `202610070003_venue_double_booking.sql` |
| ADR-04 | `db/eventRequests.ts`, `db/equipment.ts` |
| ADR-05 | `client/src/venues/searchApi.ts` (`sgtToIso`, `formatSgt`), `client/src/screens/{WorkQueue,VenueHolds,RequestForm}.tsx`, `client/src/venues/blocksApi.ts`, `venues/holdFields.ts` |
| ADR-06 | `db/auditLogs.ts`, `events/getHistory.ts`, `events/updateDraft.ts`, `db/eventRequests.ts`, `202609240000_event_planning_and_audit.sql`, `202610170003_event_draft_change_history.sql`, `202610050003_venue_operations.sql` |
| ADR-07 | `202610060001_venue_booking_decisions.sql` (table and policy), `202610160001_event_notifications.sql`, `202610200003_notifications_inbox_reminders.sql`, `db/eventNotifications.ts`, `docs/notifications.md`, `docs/notification-inbox.md`, `docs/venue-holds.md` |
| ADR-08 | `202610050001_venue_holds.sql:126-150,302-312`, `202610200003`, `202610200004`, `202610280001` |
| ADR-09 | `auth/{index,actingRole,roles,login}.ts`, `202610180001_account_multi_roles.sql`, `202610180003_separation_of_duties.sql`, `202610200002_acting_role_functions.sql` |
| ADR-10 | `202610280001_waiting_list.sql`, `registrableEvents/index.ts`, `db/registrableEvents.ts`, `events/registrationSettings.ts` |
| ADR-11 | `202610190004_safety_check_queue.sql` to `202610290002_safety_rework_resubmit.sql`, `events/{safetyDecisions,safetyDecisionRoutes,safetyRereviewRoutes}.ts`, `safetyChecks/index.ts`, `docs/safety-checks.md` |
| Current replacement/confirmation revision | `202610170001_venue_replacement.sql`, `202610170002_confirmation_rechecks_and_disruptions.sql`, `202610160005_event_confirmation_record_repair.sql`, `202610220001_safety_approval_gate.sql`, `202610290001_requested_equipment_outstanding.sql` |
| Change log | Migration headers (`202610050003`, `202610050004`, `202610090001`, `202610100001`, `202610140003`, `202610150002`), `git log` story commits, the SG2-95 brief (Jira status), and the Sprint 4 story-to-PR list supplied for this revision |
| Known limits | `events/{submit,decide,clarifications,updatePlanning,assignCoordinator,complete,changeRequests}.ts`, `db/eventRequests.ts`, `db/venueLayouts.ts`, `events/fields.ts` (`EVENT_STATUSES`; `STATUS_TRANSITIONS` was removed by PR #120), `202610220001_safety_approval_gate.sql` and `202610220002_event_cancellation.sql` (the only database-enforced status rules) |
