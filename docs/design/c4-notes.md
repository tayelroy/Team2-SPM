# C4 model notes (SG2-95, updated for SG2-96)

Source: [`c4-model.drawio`](c4-model.drawio), seven pages. The 26 Oct 2026 b7e2b1a baseline now includes the SG2-60 registration and SG2-64 change-request implementation labels from merged main a9eb363; the layout is unchanged. Until 26 Oct the model was the Structurizr file `connectsphere.dsl`; SG2-96 moved it to draw.io so the team edits the diagrams by hand.

Colours on every page: orange (`#F5A623`) = built for the Week 7 changes; green (`#B6D7A8`, green arrows) = built for the 15 Oct 2026 clarifications; grey dashed (`#DDDDDD`) = not built, with the Jira story in the label. Each page has its own key.

## Views

| Page | Shows |
|---|---|
| C1 System Context | The 7 roles and ConnectSphere, with what each role does today. One account may hold several roles (SG2-104). |
| C2 Containers | Web App, API, and the Supabase project: Auth, RLS, SECURITY DEFINER RPCs and triggers, tables, and the three pg_cron jobs |
| C3 Components (1/5) | Request pipeline: `requireAuth`/`requirePermission` with the acting role (`X-Acting-Role`), `auth/policy`, auth routes |
| C3 Components (2/5) | Event handlers, coordinator assignment and oversight, notifications/profile/work queue, safety check review, change requests and impact |
| C3 Components (3/5) | Venue catalogue (including soft delete), setup/safety details, unavailability, holds (including expiry changes), scheduled jobs |
| C3 Components (4/5) | Venue requests and bookings, clashes, equipment, venue replacement, change or cancel one venue |
| C3 Components (5/5) | Event search, cancellation, registration settings and windows, attendee registration (SG2-60); waiting list and registration management «planned» (SG2-61/62) |

C3 is split over five pages so each one stays readable at A4 landscape. Pages 2–5 leave out the middleware's `account_roles` read, which page 1 shows.

## Editing and rendering

- Open the file in [app.diagrams.net](https://app.diagrams.net) (File → Open from → Device, or straight from GitHub) or the draw.io desktop app. Each C4 element was placed from draw.io's C4 shape library, so *Edit Data* (Ctrl/Cmd+M) shows its `c4Name`, `c4Type`, `c4Technology` and `c4Description`; the label reads those fields.
- To add an element, copy one of the same kind on the page (it keeps the colours and the data fields) or use *More Shapes → C4*. Colour a Week 7 or 15 Oct change as in the key.
- Save as uncompressed XML (File → Properties → untick *Compressed*) so pull-request diffs stay readable.
- Update the snapshot in each page title when the content changes.
- `node docs/design/render.mjs [outDir]` writes the Drive PDFs: C1, C2 and C3 (five pages) as separate files, as before. It needs the repo's Playwright Chromium and network access for the draw.io viewer, or `DRAWIO_VIEWER=<path to viewer-static.min.js>` to work offline.

## Roles (C1/C2) — source: `ROLES`/`PERMISSIONS` in `server/src/auth/policy.ts`

| Role | What it does at this snapshot |
|---|---|
| Event Organiser | Creates, edits, submits and deletes own drafts. Sets registration capacity and window (SG2-63) and sees who registered. Raises and views persisted change requests (SG2-64). Asks to cancel (SG2-67). Views own requests, stage, history, safety decisions and confirmation. Clarifications. Own notifications. |
| Event Coordinator | Reviews, decides and plans assigned events. Clarifications. Venue search and suitability. Requests several venues per event (SG2-82), withdraws a request, changes or cancels one venue (SG2-83). Requests equipment. Views arrangements. Reworks a safety-rejected event (SG2-92). Confirms, completes and cancels events (SG2-58/67). Work queue. Notifications and reminder frequency (SG2-69). |
| Event Coordinator Lead «Week 7» | Unassigned queue (SG2-87). Assigns or reassigns a coordinator (SG2-97/88). Oversight of assignments and active events (`event_request.oversight.view`, SG2-89). Stage and history. Notifications (SG2-68). |
| Safety Officer «Week 7» | Safety check queue (`safety_checks.read`, SG2-91) and decisions: approve, reject or request changes (`event_request.safety_decision.record`, SG2-92/93). Reads venue setup and safety details (`venues.operations.read`, 202610160002), equipment placement, stage and history. Event search. |
| Venue Staff | Venue CRUD, layouts and soft delete (SG2-106). Setup/turnaround and safety details (SG2-77). Temporary unavailability (SG2-80). Holds and their expiry (SG2-84/85, 15 Oct). Decides venue requests. Bookings by venue and release. Clashes and conflicts. Approves capacity exceptions (SG2-66 AC5). Confirms flagged venue requests again after a safety Request Changes (SG2-93). Work queue. Notifications. |
| Technical Support Staff | Equipment records, availability and reservations. Requirement arrangements. Changes user roles (`PATCH /api/users/:userId/role`). Confirms flagged equipment again after a safety Request Changes (SG2-93). Work queue. Notifications. |
| Attendee | Finds confirmed events open for registration (`events.registrable.read`, SG2-59), registers with phone and needs and receives confirmation (SG2-60). Profile and inbox. Waiting-list handling and own-registration management/withdrawal remain «planned» (SG2-61/62). |

Every role has `profile.read`/`profile.update` and `notifications.inbox`. A person may hold several of these roles and picks the acting role in the header (SG2-104).

## Containers

| Element | Source |
|---|---|
| Web Application | `client/src` (React + Vite). Built into `server/public`, see `server/vercel.json` and README "Deployment" |
| API Application | `server/src/app.ts`. Vercel function `server/api/index.js` (`/api/*`, `/health/*` routes in `server/vercel.json`) |
| Supabase Auth | `server/src/auth/login.ts` (`signInWithPassword`), `auth/supabase.ts` (`auth.getUser`). No signup route |
| Row Level Security | `create policy …` across `supabase/migrations/*.sql`, e.g. `202610070002_legacy_table_rls.sql`, `202610050003_venue_operations.sql` |
| SECURITY DEFINER RPCs & triggers | Functions marked `security definer` in the migrations, e.g. `decide_venue_booking_request`, `create_venue_hold`, `change_venue_hold_expiry`, `delete_venue`, `refresh_safety_check_status`, `record_safety_decision`, `confirm_safety_rereview`, `confirm_event`, `cancel_event`, `apply_accepted_event_change`, and triggers such as `venue_unavailability_flag_bookings`, `venue_bookings_refresh_clashes` and the safety-check refresh triggers |
| Postgres tables | `create table` in `supabase/migrations/*.sql` (ER: `data-model.drawio`, as of 16 Oct) |
| Scheduled jobs «Week 7» | pg_cron: `venue-hold-deadlines` every minute (`202610050001_venue_holds.sql`, SG2-85); `registration-windows` every minute (SG2-63); `sg2-69-arrangement-reminders` hourly (SG2-69) |

## API components (C3)

| Component | Source (under `server/src/`) | Story |
|---|---|---|
| requireAuth / requirePermission | `auth/index.ts`, `auth/supabase.ts`, `auth/actingRole.ts` | SG2-104 acting role |
| Permission policy | `auth/policy.ts` | SG2-86 roles |
| Auth & role routes | `auth/login.ts`, `logout.ts`, `roles.ts`, `/api/auth/me` | — |
| Event request handlers | `events/*.ts` (routes in `app.ts`) | — |
| Coordinator assignment & oversight «Week 7» | `assignmentQueue/index.ts`, `events/listAssignable.ts`, `events/assignCoordinator.ts`, `coordinatorOverview/index.ts` | SG2-87/88/89/97 |
| Venue catalogue & search | `venues/index.ts`, `layouts.ts`, `availability.ts`, `search.ts`, `suitabilityRoutes.ts` | delete: SG2-106 |
| Venue setup & safety details «Week 7» | `venues/operations.ts`, `db/venueOperations.ts` | SG2-77 |
| Venue unavailability «Week 7» | `venues/blocks.ts`, `db/venueBlocks.ts` | SG2-80 |
| Tentative venue holds «Week 7» | `venues/holds.ts`, `db/venueHolds.ts` | SG2-84/85; expiry change 15 Oct |
| Venue requests & bookings | `venues/bookingRequests.ts`, `conflicts.ts`, `bookings.ts` | SG2-82 |
| Venue clashes «Week 7» | `venues/clashes.ts`, `db/venueClashes.ts` | SG2-79 |
| Equipment | `equipment/*.ts` | SG2-53/56 |
| Notifications, profile, work queue | `notifications/`, `profile/`, `workQueue/` | SG2-68/69 |
| Safety check review «Week 7» | `safetyChecks/index.ts`, `events/safetyDecisionRoutes.ts`, `events/safetyRereviewRoutes.ts` | SG2-91/92/93/94 |
| Venue replacement «Week 7» | existing `venues/bookingRequests.ts` routes, `db/venueBookings.ts`, `db/venueDisruptions.ts` | SG2-81 |
| Change/cancel one venue «Week 7» | `venues/bookingRequests.ts`, `venues/bookings.ts` | SG2-83 |
| Search, cancellation & registration settings | `eventSearch/`, `events/cancellation.ts`, `events/registrationRoutes.ts`, `registrableEvents/` | SG2-70, 67, 63, 59 |
| Change requests & impact «15 Oct» | `events/changeRequests.ts`, `db/changeRequests.ts`, `event_change_requests`; `raise_event_change_request()` and `apply_accepted_event_change()` | SG2-64 raise/view/persistence and SG2-66 impact/acceptance built; remaining decision/refusal workflow SG2-65 planned |
| Attendee registration | `registrableEvents/registration.ts`, `db/registrations.ts`, `register_for_event()` | SG2-60 built |
| Waiting list & registration management «planned» | not built | SG2-61/62; attendee change notices SG2-102 |
| User-scoped DB adapters | `db/user-client.ts` + the store modules that call it | — |
| Service-role DB adapters | `db/supabase.ts` (`getSupabaseAdminClient`) + `db/eventRequests.ts`, `assignmentQueue.ts`, `workQueue.ts`, `users.ts`, `accountRoles.ts`, `auditLogs.ts`, `eventNotifications.ts` | — |

## Replacement, safety and confirmation contracts

- SG2-81 extends the existing booking routes; the replacement component groups this responsibility and is not a separate service or endpoint. An assigned Coordinator sends `replaces_booking_id` on the booking-request POST for an affected confirmed booking of the same event. Pending replacement requests reserve nothing.
- The Venue Staff decision RPC atomically creates the replacement booking, releases the original booking, cancels its old request, records history and sends the notices. The event's date, time, attendance and requirements stay.
- A new disruption flag notifies the current Coordinator; Preparation/Confirmed events return to Planning, lose the confirmation stamp and notify the Organiser (`202610170001_venue_replacement.sql`).
- The database moves an approved or planning event into `awaiting_safety_check` once every venue is booked and every equipment request is reserved with no shortfall, and back to `planning` if an arrangement is later added, released or disrupted (SG2-91). Only an Approve decision moves it into Preparation (`safety_approval_gate`, SG2-94), and `confirm_event` needs that approval to still stand.
- 15 Oct clarification: an event in Preparation or Confirmed is read-only; an accepted significant change returns it to Planning (`apply_accepted_event_change`, SG2-66), where every check, the safety check included, runs again.

## Where the code differs from the brief

- **Change requests:** SG2-64 now persists raised requests in `event_change_requests`, exposes them to the organiser and assigned coordinator and notifies the coordinator. Impact checking, acceptance and return to Planning are built (SG2-66); the remaining decision/refusal workflow is SG2-65.
- **Attendee:** finding and registering for events are built (SG2-59/60). The waiting list (first come, first served, 15 Oct) and own-registration/withdrawal workflow remain SG2-61/62. Prototype attendee screens are not evidence that those remaining workflows are implemented.
- The Safety Officer has `notifications.inbox` but not `notifications.read`: the header inbox works, `GET /api/notifications` does not.
- Notifications are in-app only (`notifications`, `venue_hold_notifications`). Neither the server nor the migrations send email.

## Extensibility: adding a role or a status (SG2-96 NFR)

The policy is data, so a new role or status is added in a fixed set of places; the tests below fail until every place agrees.

**A new role**

1. Database: add the role to the `account_roles_role_check` constraint and a row in `public.roles` (pattern: `202610050004_week7_roles.sql`). Accounts get it through `account_roles` (one row per role held, SG2-104).
2. API: add it to `ROLES` in `server/src/auth/policy.ts` and grant it the permissions it needs in `PERMISSIONS`; everything not granted is denied. `requireAuth` and the acting-role header then work unchanged.
3. Database checks: SECURITY DEFINER functions that check a role by name (for example `confirm_safety_rereview`) need the new role only if it performs that action.
4. Client: add it to `ROLES` in `client/src/mock/types.ts`, its navigation in `mock/viewModel.ts` (`navFor`, `primaryActionFor`) and its heading in `mock/data.ts` (`HEAD`).
5. Tests: `server/src/authorization.test.ts` lists the supported roles and each role's exact permission set, so it fails until the new role and its grants are added there. Add a demo account to the README table.

**A new event status**

1. Database: `alter type public.event_status add value …` in a migration, plus any trigger or RPC that moves events into or out of it.
2. API: add it to `EVENT_STATUSES` and `STATUS_TRANSITIONS` in `server/src/events/fields.ts`, and map it to a stage in `server/src/events/stageCalculator.ts`.
3. Client: add its label and badge in `client/src/mock/viewModel.ts` (`statusLabel`, `badgeStyle`) and the status lists in `client/src/api/eventRequests.ts`.
4. Tests: `server/src/events/fields.test.ts` walks every value of `EVENT_STATUSES` and `supabase/tests/event_status_flow.sql` asserts the exact enum values in order, so both fail until they list the new status; add its stage to `server/src/stageCalculator.test.ts`.
5. Diagrams: add the state and its transitions to `event-status-model.drawio`.
