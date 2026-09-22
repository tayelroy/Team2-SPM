# Internal work queue — SG2-41

The internal dashboard reads Supabase through `GET /api/work-queue`. Selecting a
card reads `GET /api/work-queue/:kind/:itemId` and opens that exact event or
request, including its stored facts and Singapore-time window. `Refresh` rereads
the current view; returning from details refreshes the list. No production
request falls back to mock content. Organiser and attendee dashboards retain
their existing behavior.

## Queue rules

| Role | Work shown |
| --- | --- |
| Event Coordinator | Unassigned and personally assigned `submitted` / `under_review` requests in **Awaiting review**. Personally assigned `approved`, `planning` and `confirmed` events in **My assigned events**. Each record appears once. |
| Venue Staff | Team-wide `pending` venue booking requests for active events. |
| Technical Support Staff | Team-wide `pending` equipment requests for active events. |

Draft, completed, cancelled and rejected events do not produce queue work.
Another coordinator's assigned event is excluded. Decided/cancelled resource
requests disappear immediately. Queue and detail reads apply the same verified
role and assignment constraints; client-supplied identity or role cannot widen
the query. Both endpoints require `work_queue.read` and disable HTTP caching.
An item that has left the caller's queue returns 404 with a refresh instruction.
Storage failures return 503, never a misleading empty queue.

The API reads every 1,000-row database page, using stable identity ordering.
There is no four-card cutoff. Null dates/facts are explicit, counts come from
returned records, and session changes discard previous selections and late
responses. Cards support keyboard activation; opening details moves focus to
the selected record's heading. The layout stacks at narrow widths.

## Supabase deployment

Apply `supabase/migrations/202609220001_internal_work_queue.sql` to the configured
Supabase project after the preceding migrations and before serving the new
application. Configure the existing server-only `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` environment variables as usual.
The production composition always uses Supabase. A Git commit/push does not
apply hosted database migrations: the current CI workflow applies them only to
its disposable test database.

The migration adds:

- `venue_booking_requests`: event, venue, requested time window, status and notes.
- `equipment_requests`: event, equipment, positive quantity, time window, status and notes.
- `internal_work_items`: a service-role-only view of active queue work and details.

Existing `venue_bookings` are holds/confirmed bookings, and
`equipment_reservations` are reservations; neither represents a pending decision.
They are preserved and not reinterpreted as requests. New request tables enforce
foreign keys, valid states and increasing time windows. Direct anonymous or
authenticated access is revoked; privileged server workflows own request writes.
RLS is enabled and forced on both new tables. No shared sample data is inserted.

SG2-41 covers gathering and opening work. Request creation, coordinator
assignment and approval/rejection mutations remain separate workflows. Their
future server operations should write the new request tables. The old standalone
booking-approval and equipment-reservation prototype screens are not connected
to these queue records. Until real requests are created, those staff dashboards
correctly show empty queues.

## Verification and test responsibilities

| Layer | Evidence |
| --- | --- |
| Database adapter | Verified role/assignment and selected-record query constraints, all-page retrieval, empty queues and database failures. |
| HTTP routes | Role grants, missing credentials, invalid IDs, no-store responses, missing items and generic outage handling. |
| Client adapter | Authenticated list/detail transport and recovery instructions for HTTP/network/malformed responses. |
| Components | Grouping, accurate counts, exact selection, complete detail values, empty/error/refresh states, account changes and late responses. |
| App integration | Signing in and opening a queue record through the application composition. Replaces obsolete mock-dashboard navigation tests. |
| Browser SG2-41-P01 | Empty-to-populated refresh, coordinator assignment isolation, keyboard navigation, all three roles' exact record details and desktop/mobile rendering. One combined acceptance journey. |
| SQL SG2-41-DB01 | Actual migration/view, active/inactive state partitions, decision removal, full detail values, foreign keys, quantities, intervals and client-access restrictions. |

Local validation on 22 September 2026 used Node 22.22.2. `npm run ci` passed:
494 backend, 423 frontend and 19 reviewer tests, with **100% per-file statements,
branches, functions and lines** in both applications. Coverage inclusion and
thresholds were not weakened and no ignore directives were added.

All 19 browser journeys passed against the production build and real Express
routes, using disposable identity/storage providers in `e2e/server.ts`. The
installed Chrome was selected through a temporary Playwright config because the
required bundled Chromium revision was absent. Reports and screenshots are
outside the repository. The 13 regression-gate tests and required SG2-26 report
gate passed. The queue was visually inspected at 1440×1000 and 390×844, with a
further native Chrome check of request details. No relevant browser errors or
framework overlays were observed.

All six migrations and four SQL suites passed in disposable PGlite 0.5.8 /
PostgreSQL 18.3. CI also runs the new SQL suite in its native PostgreSQL 17
service. Local tests do not claim hosted Supabase Auth, deployment or native
CI execution; no shared Supabase data was touched.
