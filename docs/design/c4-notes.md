# C4 model notes (SG2-95)

Source: [`connectsphere.dsl`](connectsphere.dsl) (moved from `docs/context-diagram.dsl`). As of PR90 head 61416cc (16 Oct 2026).
Orange (`#f5a623`, tag `Week 7`) = built for the Week 7 changes. Grey dashed (`#DDDDDD`, tag `Planned`) = not built; the label names the Jira story.

## Views

| View | Shows |
|---|---|
| `C1_Context` | 7 roles → ConnectSphere, with what each does today |
| `C2_Containers` | Web App, API, and the Supabase project (Auth, RLS, SECURITY DEFINER RPCs, tables, pg_cron job) |
| `C3_API_Components` (1/4) | Request pipeline: `requireAuth`/`requirePermission`, `auth/policy`, auth routes |
| `C3_API_Components_Events` (2/4) | Event handlers, coordinator assignment, notifications/profile/work queue, safety check «planned» |
| `C3_API_Components_Venues` (3/4) | Venue catalogue, setup/safety details, unavailability, holds, pg_cron hold job |
| `C3_API_Components_Bookings` (4/4) | Venue requests/bookings, clashes, equipment, built venue replacement, general venue change «planned» |

C3 is split over four views so each page stays readable at A4 landscape. Pages 2–4 leave out the middleware's `account_roles` read, which page 1 shows. With that edge in, the smetana layout pushes elements into the title.

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

| Role | What it does at this snapshot |
|---|---|
| Event Organiser | Creates, edits, submits and deletes own drafts. Views own organisation's requests, stage, history and confirmation. Clarifications. Discovers eligible own-event capacity requests through Capacity exceptions and approves an exception using the existing suitability action. Own notifications. |
| Event Coordinator | Reviews, decides and plans assigned requests. Clarifications. Venue search and suitability. Requests venues and withdraws a request (SG2-82). Views and releases bookings. Sees clashes and conflicts. Requests equipment. Views arrangements. Confirms and completes events. Work queue. Notifications. |
| Event Coordinator Lead «Week 7» | Unassigned queue (`event_request.queue.view`, SG2-87). Lists assignable coordinators and assigns or reassigns one (`event_request.assign_coordinator`, SG2-97). Stage and history. Notifications (SG2-68). Oversight «planned» SG2-89. |
| Safety Officer «Week 7» | Placeholder desk (`SafetyDashboard`). API grants only `event_request.stage.view`, `event_request.history.view`, `equipment_requirements.read` and profile. Safety check «planned» SG2-91/92/93/94. |
| Venue Staff | Venue CRUD and layouts. Setup/turnaround and safety details (SG2-77). Blocks and temporary unavailability (SG2-80). Holds (SG2-84/85). Decides venue requests. Bookings by venue and release. Clashes and conflicts. Capacity exceptions. Work queue. Notifications. |
| Technical Support Staff | Equipment records, availability and reservations. Requirement arrangements. `PATCH /api/users/:userId/role`. Reads venue availability, operations and holds. Discovers eligible cross-event capacity requests through Capacity exceptions and records exceptions; Venue Staff separately decide the booking. Work queue. Notifications. |
| Attendee | Profile only. Dashboard and `AttendeeEvent` use mock data (`client/src/mock`). |

## Containers

| Element | Source |
|---|---|
| Web Application | `client/src` (React + Vite). Built into `server/public`, see `server/vercel.json` and README "Deployment" |
| API Application | `server/src/app.ts`. Vercel function `server/api/index.js` (`/api/*`, `/health/*` routes in `server/vercel.json`) |
| Supabase Auth | `server/src/auth/login.ts` (`signInWithPassword`), `auth/supabase.ts` (`auth.getUser`). No signup route (`app.ts` comment) |
| Row Level Security | `create policy …` across `supabase/migrations/*.sql`, e.g. `202610070002_legacy_table_rls.sql`, `202610050003_venue_operations.sql` |
| SECURITY DEFINER RPCs & triggers | Functions marked `security definer` in migrations: `decide_venue_booking_request`, `withdraw_venue_booking_request`, `release_venue_booking`, `create_venue_hold`, `change_venue_hold`, `process_venue_hold_deadlines`, `confirm_event`, `manage_equipment_requirements`, `manage_equipment_reservations`, `check_equipment_availability`, `list_venue_unavailability`, and the triggers `venue_unavailability_flag_bookings`, `venue_bookings_refresh_clashes`, `venue_operations_refresh_clashes` |
| Postgres tables | `create table` in `supabase/migrations/*.sql` (full ER: `data-model.puml`) |
| Hold-deadline job «Week 7» | `cron.schedule('venue-hold-deadlines','* * * * *', …process_venue_hold_deadlines())` in `202610050001_venue_holds.sql`. Warning lead time: `venue_hold_settings.warning_lead_seconds`, default 86400 |

## API components (C3)

| Component | Source | Story |
|---|---|---|
| requireAuth / requirePermission | `server/src/auth/index.ts`, `auth/supabase.ts` | — |
| Permission policy | `server/src/auth/policy.ts` | SG2-86 roles |
| Auth & role routes | `auth/login.ts`, `logout.ts`, `roles.ts`, `/api/auth/me` in `auth/index.ts` | — |
| Event request handlers | `server/src/events/*.ts` (routes in `app.ts`) | — |
| Coordinator assignment «Week 7» | `assignmentQueue/index.ts`, `events/listAssignable.ts`, `events/assignCoordinator.ts` | SG2-87, SG2-97 |
| Venue catalogue & search | `venues/index.ts`, `layouts.ts`, `availability.ts`, `search.ts`, `suitabilityRoutes.ts` | — |
| Venue setup & safety details «Week 7» | `venues/operations.ts`, `db/venueOperations.ts` | SG2-77 |
| Venue unavailability «Week 7» | `venues/blocks.ts`, `db/venueBlocks.ts` | SG2-80 |
| Tentative venue holds «Week 7» | `venues/holds.ts`, `db/venueHolds.ts` | SG2-84/85 |
| Venue requests & bookings | `venues/bookingRequests.ts`, `conflicts.ts`, `bookings.ts` | withdraw: SG2-82 |
| Venue clashes «Week 7» | `venues/clashes.ts`, `db/venueClashes.ts` | SG2-79 |
| Equipment | `equipment/index.ts`, `requirements.ts`, `availability.ts`, `reservations.ts` | — |
| Notifications, profile, work queue | `notifications/index.ts`, `profile/index.ts`, `workQueue/index.ts` | SG2-68 notices |
| User-scoped DB adapters | `db/user-client.ts` + store modules that call it | — |
| Service-role DB adapters | `db/supabase.ts` (`getSupabaseAdminClient`), used by `events/*`, `assignmentQueue`, `workQueue`, `profile`, `auth/roles.ts`, `venues/bookingRequests.ts`, `conflicts.ts`, `bookings.ts`, `clashes.ts`, `suitabilityRoutes.ts` | — |
| Safety check review «planned» | none. Only the statuses `awaiting_safety_check`/`safety_rejected`/`preparation` exist (`202610090001_event_status_flow.sql`, `events/fields.ts`) | SG2-91/92/93/94 |
| Venue replacement «Week 7» | Existing `venues/bookingRequests.ts` routes, `db/venueBookings.ts`, `db/venueDisruptions.ts`; `202610170001_venue_replacement.sql` | SG2-81 |
| Change/cancel one venue «planned» | No general change flow; separate from SG2-81 replacement | SG2-83 |

## Replacement and confirmation contracts

- SG2-81 extends existing booking routes; the C3 replacement component groups this responsibility and is not a separate service or a new HTTP endpoint. An assigned Coordinator sends `replaces_booking_id` on the existing booking-request POST for an affected confirmed booking of the same event. Pending replacement requests reserve nothing.
- The existing Venue Staff decision RPC atomically creates the replacement booking and releases the original booking, cancels its old request, records history and sends release/approval notices. The event's date, time, attendance and requirements are retained.
- In `202610170001_venue_replacement.sql`, each newly inserted disruption flag raises a `venue_unavailable` notice to the current Coordinator. Preparation/Confirmed events return to Planning, lose the confirmation stamp, gain status history and notify the Organiser (deduplicated if the same recipient). Earlier flags are not retrospectively announced.
- `202610170002_confirmation_rechecks_and_disruptions.sql` is the final `confirm_event` definition: it retains both SG2-81 affected-booking refusal and PR90 persisted venue/equipment/registration recheck gates. `202610160005_event_confirmation_record_repair.sql` repairs the confirmation columns without replacing this RPC. UI readiness follows the same persisted flags and affected-booking count.
- `61416cc` supports `venue_unavailable` throughout the client notification contract and drawer. No Safety decision route is added by these changes.

## Where the code differs from the brief

- **SG2-88:** Jira is now Done (fresh export 16 Oct 2026). The Lead assigns and reassigns through `PATCH /api/event-requests/:eventId/coordinator`; SG2-97 supplies the permission and SG2-87 the unassigned queue. The diagrams show this as built.
- **SG2-77:** the migration says the safety details are "for the Safety Officer", but `venues.operations.read` does not grant `safety_officer`. The Safety Officer cannot read them at this snapshot.
- The Safety Officer has no `notifications.read`. `AppShell.tsx` shows the notifications drawer only to the Coordinator, Venue Staff, Technical Support Staff, Organiser and Lead.
- Notifications are in-app only: the `notifications` and `venue_hold_notifications` tables. Neither the server nor the migrations send email.
- Removed the old "Planned" tags on Event Coordinator and Technical Support Staff. Both are built. Attendee is still a prototype.
