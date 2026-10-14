# C4 model notes (SG2-95)

Source: [`connectsphere.dsl`](connectsphere.dsl) (moved from `docs/context-diagram.dsl`). As of main 1d1e336 (14 Oct 2026).
Orange (`#f5a623`, tag `Week 7`) = built for the Week 7 changes. Grey dashed (`#DDDDDD`, tag `Planned`) = not built; the label names the Jira story.

## Views

| View | Shows |
|---|---|
| `C1_Context` | 7 roles → ConnectSphere, with what each does today |
| `C2_Containers` | Web App, API, and the Supabase project (Auth, RLS, SECURITY DEFINER RPCs, tables, pg_cron job) |
| `C3_API_Components` (1/4) | Request pipeline: `requireAuth`/`requirePermission`, `auth/policy`, auth routes |
| `C3_API_Components_Events` (2/4) | Event handlers, coordinator assignment, notifications/profile/work queue, safety check «planned» |
| `C3_API_Components_Venues` (3/4) | Venue catalogue, setup/safety details, unavailability, holds, pg_cron hold job |
| `C3_API_Components_Bookings` (4/4) | Venue requests/bookings, clashes, equipment, venue replacement «planned» |

C3 is split over four views so each page stays readable at A4 landscape. Pages 2–4 leave out the middleware's `account_roles` read, which page 1 shows. With that edge in, the smetana layout pushes elements into the title.

## Render

```sh
bash ~/.cache/sg2-95-tools/structurizr-cli/structurizr.sh export -w docs/design/connectsphere.dsl -f plantuml/c4plantuml -o /tmp/sg2-95-render/c4
cd /tmp/sg2-95-render/c4
java -jar ~/.cache/sg2-95-tools/plantuml.jar -Playout=smetana -tsvg *.puml
java -jar ~/.cache/sg2-95-tools/plantuml.jar -Playout=smetana -tpng *.puml
```

The Structurizr export cannot write `!pragma layout smetana` into its `.puml` files. `-Playout=smetana` applies the same pragma from the command line. Without it, Graphviz is missing, so PlantUML draws an error image but **still exits 0**.

## Roles (C1/C2) — source: `ROLES`/`PERMISSIONS` in `server/src/auth/policy.ts`, `client/src/screens/Dashboard.tsx`

| Role | What it does on main |
|---|---|
| Event Organiser | Creates, edits, submits and deletes own drafts. Views own organisation's requests, stage, history and confirmation. Clarifications. Approves capacity exceptions for own event. Own notifications. |
| Event Coordinator | Reviews, decides and plans assigned requests. Clarifications. Venue search and suitability. Requests venues and withdraws a request (SG2-82). Views and releases bookings. Sees clashes and conflicts. Requests equipment. Views arrangements. Confirms and completes events. Work queue. Notifications. |
| Event Coordinator Lead «Week 7» | Unassigned queue (`event_request.queue.view`, SG2-87). Lists assignable coordinators and assigns or reassigns one (`event_request.assign_coordinator`, SG2-97). Stage and history. Notifications (SG2-68). Oversight «planned» SG2-89. |
| Safety Officer «Week 7» | Placeholder desk (`SafetyDashboard`). API grants only `event_request.stage.view`, `event_request.history.view`, `equipment_requirements.read` and profile. Safety check «planned» SG2-91/92/93/94. |
| Venue Staff | Venue CRUD and layouts. Setup/turnaround and safety details (SG2-77). Blocks and temporary unavailability (SG2-80). Holds (SG2-84/85). Decides venue requests. Bookings by venue and release. Clashes and conflicts. Capacity exceptions. Work queue. Notifications. |
| Technical Support Staff | Equipment records, availability and reservations. Requirement arrangements. `PATCH /api/users/:userId/role`. Reads venue availability, operations and holds. Capacity exceptions. Work queue. Notifications. |
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
| Venue replacement «planned» | none | SG2-81, SG2-83 |

## Where the code differs from the brief

- **SG2-88:** main already lets the Lead assign and reassign through `PATCH /api/event-requests/:eventId/coordinator` (SG2-97 moved `event_request.assign_coordinator` to `event_coordinator_lead`), and the Lead's queue is built (SG2-87). The diagrams show this as built. The code does not mark which part of SG2-88 is still open.
- **SG2-77:** the migration says the safety details are "for the Safety Officer", but `venues.operations.read` does not grant `safety_officer`. The Safety Officer cannot read them on main.
- The Safety Officer has no `notifications.read`. `AppShell.tsx` shows the notifications drawer only to the Coordinator, Venue Staff, Technical Support Staff, Organiser and Lead.
- Notifications are in-app only: the `notifications` and `venue_hold_notifications` tables. Neither the server nor the migrations send email.
- Removed the old "Planned" tags on Event Coordinator and Technical Support Staff. Both are built. Attendee is still a prototype.
