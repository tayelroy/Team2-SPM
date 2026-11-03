# C4 model notes (SG2-95)

Source: [`connectsphere.dsl`](connectsphere.dsl) (moved from `docs/context-diagram.dsl`). As of main 4881413 (3 Nov 2026); re-checked against `server/src/app.ts`, `server/src/auth/policy.ts` and `supabase/migrations/` through `202610310001`.
Orange (`#f5a623`, tag `Week 7`) = built for the Week 7 customer changes. Every other element is built and plain. The model no longer has a `Planned` tag: all 23 Sprint 4 stories are merged, so nothing in it is unbuilt.

## Views

| View | Shows |
|---|---|
| `C1_Context` | 7 roles → ConnectSphere, with what each does |
| `C2_Containers` | Web App, API, and the Supabase project (Auth, RLS, SECURITY DEFINER RPCs, tables, pg_cron jobs) |
| `C3_API_Components` (1/6) | Request pipeline: `requireAuth`/`requirePermission` (incl. acting role), `auth/policy`, auth routes |
| `C3_API_Components_Events` (2/6) | Event handlers, coordinator assignment, coordinator oversight, event search, notification inbox/profile/work queue |
| `C3_API_Components_Changes` (3/6) | Event change requests, event cancellation, safety check review |
| `C3_API_Components_Registrations` (4/6) | Attendee registration and waiting list, registration overview and settings, pg_cron jobs |
| `C3_API_Components_Venues` (5/6) | Venue catalogue (incl. delete), setup/safety details, unavailability, holds (incl. expiry change), pg_cron jobs |
| `C3_API_Components_Bookings` (6/6) | Venue requests/bookings, clashes, equipment, venue replacement, change/cancel one venue |

C3 is split over six views so each page stays readable at A4 landscape. Pages 2–6 leave out the middleware's `account_roles` read, which page 1 shows. With that edge in, the smetana layout pushes elements into the title. `render.mjs` lists the C3 views by name when it builds the component PDF, so a view added here has to be added there too.

## Render

```sh
bash ~/.cache/sg2-95-tools/structurizr-cli/structurizr.sh export -w docs/design/connectsphere.dsl -f plantuml/c4plantuml -o /tmp/sg2-95-render/c4
cd /tmp/sg2-95-render/c4
java -Djava.awt.headless=true -jar ~/.cache/sg2-95-tools/plantuml.jar -Playout=smetana -tsvg *.puml
java -Djava.awt.headless=true -jar ~/.cache/sg2-95-tools/plantuml.jar -Playout=smetana -tpng *.puml
```

On headless macOS validation runs, `-Djava.awt.headless=true` avoids Java AWT startup failure. The source renderer can use the same option through `JAVA_TOOL_OPTIONS=-Djava.awt.headless=true`; point `PLANTUML_JAR` and `STRUCTURIZR_CLI` at the available tool files. This update was validated with official temporary PlantUML 1.2026.8 and Structurizr CLI 2025.11.09 releases, without a global install.

The Structurizr export cannot write `!pragma layout smetana` into its `.puml` files. `-Playout=smetana` applies the same pragma from the command line. Without it, PlantUML depends on Graphviz. In an environment without Graphviz it can draw an error image and **still exit 0**; inspect the output as well as the exit code. The commands require the existing PlantUML JAR and Structurizr CLI at the shown paths; if absent, rendering is unavailable until those tools are provisioned.

## Roles (C1/C2) — source: `ROLES`/`PERMISSIONS` in `server/src/auth/policy.ts`, `client/src/screens/Dashboard.tsx`

An account can hold several roles (SG2-104). Every request acts as exactly one, named in the `X-Acting-Role` header (`server/src/auth/actingRole.ts`, `client/src/auth/actingRole.ts`; the client omits it for a single-role account), and `public.acting_role()` applies the same choice in the database (`202610180001_account_multi_roles.sql`, `202610200002_acting_role_functions.sql`). `PATCH /api/users/:userId/role` replaces an account's roles with one; extra roles are granted in SQL (`auth/roles.ts`).

| Role | What it does at this snapshot |
|---|---|
| Event Organiser | Creates, edits, submits and deletes own drafts. Views own organisation's requests, stage, history and confirmation. Clarifications. Raises change requests and sees them (`event_request.change_request.raise/view`, SG2-64). Asks for a cancellation (`event_request.cancellation.request`, SG2-67). Sees registrations and the creating organiser sets registration capacity, times and closes registration (`event_request.registrations.view`, `event_request.registration_settings.update`, SG2-63). Reads safety decisions for own events. Own notifications and inbox. No longer approves capacity exceptions (SG2-66 AC5). |
| Event Coordinator | Reviews, decides and plans assigned requests. Clarifications. Venue search and suitability. Requests venues and withdraws a request (SG2-82). Views bookings and cancels one or several (`venue_bookings.release`, SG2-83); asks to change one (replacement request with `change_reason`). Sees clashes and conflicts. Requests equipment. Views arrangements. Sees change requests with their impact, accepts or refuses them, settles rechecks (SG2-65/66). Cancels events after the organiser asks (`event_request.cancel`, SG2-67). Reworks a Safety Rejected event (`event_request.safety_rework`) and reads safety decisions. Sees registrations and the waiting list. Confirms and completes events. Searches events (`events.search`). Work queue. Notifications, inbox and reminder cadence. |
| Event Coordinator Lead «Week 7» | Unassigned queue (`event_request.queue.view`, SG2-87). Lists assignable coordinators and assigns or reassigns one (`event_request.assign_coordinator`, SG2-97). Oversight of the events whose coordinator this Lead assigned (`event_request.oversight.view`, `GET /api/coordinator-overview`, SG2-89). Searches events. Stage and history. Notifications (SG2-68) and inbox. |
| Safety Officer «Week 7» | Own queue of events awaiting a safety check (`safety_checks.read`, SG2-91). Records Approve, Reject or Request Changes (`event_request.safety_decision.record`, SG2-92/93) and reads decisions. Also: `event_request.stage.view`, `event_request.history.view`, `venues.operations.read` (emergency access and restrictions, SG2-77 AC5), `equipment_requirements.read`, `events.search`, inbox and profile. |
| Venue Staff | Venue CRUD and layouts; deletes an unused venue (`venues.delete`, SG2-106). Setup/turnaround and safety details (SG2-77). Blocks and temporary unavailability (SG2-80). Holds incl. expiry change (SG2-84/85/106). Decides venue requests. Lists a venue's bookings (`venue_bookings.by_venue`); no longer releases bookings (SG2-83 AC5). Clashes and conflicts. The only role that approves capacity exceptions (SG2-66 AC5): discovers pending requests and booked venues whose attendance was raised through Capacity exceptions. Confirms venue bookings a Request Changes decision sent back (`safety_rereviews.*`, SG2-93). Searches events. Work queue. Notifications, inbox. |
| Technical Support Staff | Equipment records, availability and reservations. Requirement arrangements. Confirms equipment a Request Changes decision sent back (`safety_rereviews.*`, SG2-93). `PATCH /api/users/:userId/role`. Reads venue availability, operations and holds. Searches events. No longer approves capacity exceptions (SG2-66 AC5). Work queue. Notifications, inbox. |
| Attendee | Finds registrable events (`events.registrable.read`), registers (`events.register`, including joining or leaving a waiting list), sees and withdraws own registrations (`registrations.mine.read`, `registrations.withdraw`), inbox and profile. Wired to the real API (`client/src/screens/FindEvents.tsx`, `MyRegistrations.tsx`). |

## Containers

| Element | Source |
|---|---|
| Web Application | `client/src` (React + Vite). Built into `server/public`, see `server/vercel.json` and README "Deployment" |
| API Application | `server/src/app.ts`. Vercel function `server/api/index.js` (`/api/*`, `/health/*` routes in `server/vercel.json`) |
| Supabase Auth | `server/src/auth/login.ts` (`signInWithPassword`), `auth/supabase.ts` (`auth.getUser`). No signup route (`app.ts` comment) |
| Row Level Security | `create policy …` across `supabase/migrations/*.sql`, e.g. `202610070002_legacy_table_rls.sql`, `202610050003_venue_operations.sql`; `acting_role()` in `202610180001_account_multi_roles.sql` |
| SECURITY DEFINER RPCs & triggers | Functions marked `security definer` in migrations, e.g. `decide_venue_booking_request`, `withdraw_venue_booking_request`, `release_venue_bookings`, `delete_venue`, `create_venue_hold`, `change_venue_hold`, `change_venue_hold_expiry`, `confirm_event`, `manage_equipment_requirements`, `manage_equipment_reservations`, `register_for_event`, `join_waiting_list`, `withdraw_registration`, `request_event_cancellation`, `cancel_event`, `safety_check_queue`, `search_events`, `notification_inbox`; service-only ones the server calls after its own checks: `record_safety_decision`, `rework_safety_rejected_event`, `confirm_safety_rereview`, `raise_event_change_request`, `decide_event_change_request`, `apply_accepted_event_change`, `settle_arrangement_recheck`, `update_event_request_draft`, `change_account_roles`. Triggers: `venue_unavailability_flag_bookings`, `venue_bookings_refresh_clashes`, `venue_operations_refresh_clashes`, `safety_check_track_event`, `safety_check_refresh`, `safety_approval_gate`, `release_cancelled_event_equipment`, `keep_cancelled_events_cancelled`, `venue_change_request_check`, `venue_change_requested`, and the deferred attendee-notice constraint triggers (`event_attendee_details_changed`, `venue_booking_attendee_details_changed`) |
| Postgres tables | `create table` in `supabase/migrations/*.sql`: 30 in `public` plus `private.event_attendee_details` (full ER: `data-model.puml`) |
| Scheduled jobs | `cron.schedule` in `202610050001_venue_holds.sql` (`venue-hold-deadlines`, every minute, warning lead `venue_hold_settings.warning_lead_seconds`, default 86400), `202610200004_event_registration_settings.sql` (`registration-windows`, every minute), `202610200003_notifications_inbox_reminders.sql` (`sg2-69-arrangement-reminders`, hourly) and `202610280001_waiting_list.sql` (`waiting-list-offers`, every minute). Registered only where `pg_cron` exists |

## API components (C3)

| Component | Source | Story |
|---|---|---|
| requireAuth / requirePermission | `server/src/auth/index.ts`, `auth/supabase.ts`, `auth/actingRole.ts` | SG2-104 acting role |
| Permission policy | `server/src/auth/policy.ts` | SG2-86 roles |
| Auth & role routes | `auth/login.ts`, `logout.ts`, `roles.ts`, `/api/auth/me` in `auth/index.ts` | — |
| Event request handlers | `server/src/events/*.ts` (routes in `app.ts`) | — |
| Coordinator assignment «Week 7» | `assignmentQueue/index.ts`, `events/listAssignable.ts`, `events/assignCoordinator.ts` | SG2-87, SG2-97 |
| Coordinator oversight «Week 7» | `coordinatorOverview/index.ts`, `db/coordinatorOverview.ts`; `202610220004_coordinator_oversight.sql` | SG2-89 |
| Cross-system event search | `eventSearch/index.ts`, `db/eventSearch.ts`; `202610200005_event_search.sql` | SG2-70 |
| Event cancellation | `events/cancellation.ts`, `db/eventCancellation.ts`; `202610220002_event_cancellation.sql`, `202610210001_equipment_release.sql` | SG2-67, SG2-56 |
| Event change requests | `events/changeRequests.ts`, `events/changeImpact.ts`, `db/changeRequests.ts`, `db/changeImpact.ts`; `202610190003`, `202610260001`, `202610270001` | SG2-64, SG2-65, SG2-66 |
| Safety check review «Week 7» | `safetyChecks/index.ts`, `events/safetyDecisionRoutes.ts`, `events/safetyRereviewRoutes.ts`, `db/safetyChecks.ts`, `db/safetyDecisions.ts`, `db/safetyRereviews.ts`; `202610190004`, `202610190005`, `202610190006`, `202610220001`, `202610240001`, `202610290002` | SG2-91, SG2-92, SG2-93, SG2-94 |
| Attendee registration & waiting list | `registrableEvents/index.ts`, `registrableEvents/registration.ts`, `myRegistrations/index.ts`, `db/registrableEvents.ts`, `db/myRegistrations.ts`; `202610220003`, `202610230001`, `202610260003`, `202610280001` | SG2-59, SG2-60, SG2-61, SG2-62 |
| Registration overview & settings | `events/registrationRoutes.ts`, `events/registrationSettings.ts`, `events/registrationWindow.ts`, `db/registrations.ts`; `202610200004_event_registration_settings.sql` | SG2-63 |
| Venue catalogue & search | `venues/index.ts`, `layouts.ts`, `availability.ts`, `search.ts`, `suitabilityRoutes.ts`; `delete_venue` in `202610170007`, `202610190001` | SG2-106 delete |
| Venue setup & safety details «Week 7» | `venues/operations.ts`, `db/venueOperations.ts` | SG2-77 |
| Venue unavailability «Week 7» | `venues/blocks.ts`, `db/venueBlocks.ts` | SG2-80 |
| Tentative venue holds «Week 7» | `venues/holds.ts`, `db/venueHolds.ts`; `change_venue_hold_expiry` in `202610170007` | SG2-84/85, SG2-106 expiry |
| Venue requests & bookings | `venues/bookingRequests.ts`, `conflicts.ts`, `bookings.ts` | withdraw: SG2-82 |
| Venue clashes «Week 7» | `venues/clashes.ts`, `db/venueClashes.ts` | SG2-79 |
| Equipment | `equipment/index.ts`, `requirements.ts`, `availability.ts`, `reservations.ts` | — |
| Notification inbox, profile, work queue | `notifications/index.ts`, `db/notificationInbox.ts`, `profile/index.ts`, `workQueue/index.ts`; `202610200003_notifications_inbox_reminders.sql` | SG2-68 notices, SG2-69 inbox |
| User-scoped DB adapters | `db/user-client.ts` (forwards the acting role) + store modules that call it | — |
| Service-role DB adapters | `db/supabase.ts` (`getSupabaseAdminClient`), used by `events/*`, `assignmentQueue`, `coordinatorOverview`, `workQueue`, `profile`, `auth/roles.ts`, `venues/bookingRequests.ts`, `conflicts.ts`, `bookings.ts`, `clashes.ts`, `suitabilityRoutes.ts` | — |
| Venue replacement «Week 7» | Existing `venues/bookingRequests.ts` routes, `db/venueBookings.ts`, `db/venueDisruptions.ts`; `202610170001_venue_replacement.sql` | SG2-81 |
| Change/cancel one venue «Week 7» | `venues/bookings.ts` (`POST /api/venue-bookings/:bookingId/release`), `venues/bookingRequests.ts` (`change_reason`), `db/venueBookings.ts`; `202610210002_venue_booking_change_cancel.sql` | SG2-83 |

## Replacement and confirmation contracts

- SG2-81 extends existing booking routes; the C3 replacement component groups this responsibility and is not a separate service or a new HTTP endpoint. An assigned Coordinator sends `replaces_booking_id` on the existing booking-request POST for an affected confirmed booking of the same event. Pending replacement requests reserve nothing.
- The existing Venue Staff decision RPC atomically creates the replacement booking and releases the original booking, cancels its old request, records history and sends release/approval notices. The event's date, time, attendance and requirements are retained.
- In `202610170001_venue_replacement.sql`, each newly inserted disruption flag raises a `venue_unavailable` notice to the current Coordinator. Preparation/Confirmed events return to Planning, lose the confirmation stamp, gain status history and notify the Organiser (deduplicated if the same recipient). Earlier flags are not retrospectively announced.
- `202610170002_confirmation_rechecks_and_disruptions.sql` added the SG2-81 affected-booking refusal and the persisted venue/equipment/registration recheck gates to `confirm_event`; later migrations replace it, and the final definition is `202610290001_requested_equipment_outstanding.sql` (it also lists `safety` as outstanding without a current Approve decision, `202610220001`, and treats equipment the organiser asked for but nobody has requested as outstanding). `202610160005_event_confirmation_record_repair.sql` repairs the confirmation columns without replacing this RPC. UI readiness follows the same persisted flags and affected-booking count.
- `61416cc` supports `venue_unavailable` throughout the client notification contract and drawer.

## Safety, change and cancellation contracts

- Safety hand-off (`202610190004_safety_check_queue.sql`): triggers move an Approved or Planning event whose venue bookings are all approved and whose required equipment is all reserved to `awaiting_safety_check`, and move it back to Planning when an arrangement falls through. `events.safety_check_revision` lets a decision refuse a stale review (`202610190006`).
- Decisions (`202610190005`, `202610220001`, `202610240001`, `202610290002`): `record_safety_decision()` appends to `event_safety_decisions` and notifies the organiser and coordinator. `safety_approval_gate` allows the move into Preparation only for an event leaving `awaiting_safety_check` on an Approve decision. Reject leaves `safety_rejected`; the coordinator's rework returns it to Planning with `safety_other_recheck` outstanding. Request Changes returns it to Planning, marks `safety_venue_recheck` / `safety_equipment_recheck` / `safety_other_recheck` outstanding and flags the live venue and equipment requests in `safety_rereviews` for Venue Staff and Technical Support to confirm.
- Change requests (`202610260001`, `202610270001`, `202610190003`): the organiser's request is stored pending; the coordinator accepts (`apply_accepted_event_change`, then `decide_event_change_request`) or refuses with a reason. An accepted significant change returns a Preparation or Confirmed event to Planning and marks the affected rechecks outstanding.
- Cancellation (`202610220002`, `202610210001`): `request_event_cancellation()` by the creating organiser, `cancel_event()` by the assigned coordinator; the trigger `release_cancelled_event_equipment` releases reservations when the status becomes `cancelled`, and `keep_cancelled_events_cancelled` stops it changing again.
- Registration (`202610230001`, `202610260003`, `202610280001`): every function locks the event row first. A withdrawal sets the registration to `cancelled` and records `withdrawn_at`; a freed place is offered to the first waiting attendee for `events.waiting_list_response_hours`.
- Attendee notices (`202610270002`): `private.event_attendee_details` records the start and confirmed venues attendees were last told; a deferred constraint trigger sends one `event_changed` notice to each active registration when either differs at commit.

## Where the code differs from the brief

- **SG2-88:** the Lead assigns and reassigns through `PATCH /api/event-requests/:eventId/coordinator`; SG2-97 supplies the permission and SG2-87 the unassigned queue.
- **SG2-77:** `venues.operations.read` grants `safety_officer` (and the `venue_operations_read` RLS policy, `202610160002_safety_officer_reads_venue_operations.sql`), so the Safety Officer can read emergency access and known restrictions. The Event Coordinator Lead cannot.
- **Safety Officer notifications:** `notifications.read` (the legacy per-role notice list) still excludes the Safety Officer, but `notifications.inbox` (SG2-69) grants every role, so the Safety Officer has an inbox.
- Notifications are in-app only: the `notifications` and `venue_hold_notifications` tables, merged by the SG2-69 inbox. Neither the server nor the migrations send email.
- Booking release moved from Venue Staff to the assigned coordinator (SG2-83 AC5). Venue Staff mark the venue unavailable (SG2-80) instead.
- The older "Planned" tags on Event Coordinator, Technical Support Staff, Attendee, safety check review and change/cancel one venue were removed: all are built.
