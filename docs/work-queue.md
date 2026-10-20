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
| Event Coordinator | Personally assigned `submitted` / `under_review` requests in **Awaiting review**. Personally assigned `approved`, `planning`, `awaiting_safety_check`, `safety_rejected`, `preparation` and `confirmed` events in **My assigned events** (SG2-100, Week 7 lifecycle). Each record appears once. `unassigned` requests are not shown: since SG2-87 they wait in the Event Coordinator Lead's **Unassigned queue** (`GET /api/assignment-queue`). The view still lists them for the coordinator audience; the server reads only the caller's own rows. |
| Venue Staff | Team-wide `pending` venue booking requests for active events. |
| Technical Support Staff | Team-wide `pending` equipment requests for active events. |

Draft, completed, cancelled and rejected events do not produce queue work.
`completed` and `cancelled` are structurally absent from `internal_work_items`
(SG2-100) — they are not in either status list the view's `where` clause
checks, so a completed event leaves the active work list the moment it is
marked, with no separate exclusion filter to keep in sync as the lifecycle
grows. An event item's `ends_at` is the event's end time — the latest of its
confirmed venue bookings, or null with none — which is when the assigned
coordinator is offered **Mark as Completed** in the item's detail (SG2-100).
An event's `starts_at` is its proposed date, so the two are not shown as one
range. An assigned event in `preparation` also offers **Confirm event** in its
detail (SG2-58); see [Event confirmation](event-confirmation.md). A request
returned for clarification (`needs_clarification`, SG2-36)
is waiting on its organiser and reappears in **Awaiting review** once
resubmitted; see [Clarification exchange](clarifications.md).
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

## Coordinator planning edits (SG2-39)

The assigned coordinator edits an event's planning information from its detail
with **Edit Planning Information** (`PATCH /api/event-requests/:eventId/planning`).
The **Edit Planning Information** and **View Change History** actions sit in
the detail card's footer (`organisation-detail-footer` /
`organisation-detail-actions`), inset like the rest of the card's content.

**Drawer.** Each opening starts from the event's saved values; closing with
**Cancel**, ✕, Escape or the backdrop discards unsaved edits. The drawer
scrolls, and its messages (validation errors, a server refusal, or
**Arrangements Require Rechecking**) render above the form, so each new message
is scrolled into view and focused (`role="alert"`), including a repeat of the
same message on another failed save.

**Dates.** The server and the drawer apply the same rules, using the value being
saved for each date when the edit changes it and the stored value otherwise:

- A newly chosen proposed date must be in the future (`proposed_date must be in
  the future.`). An unchanged date is not re-judged against the clock, because
  the drawer resends every field.
- The organiser's registration opening and closing times (SG2-63) must still
  be before the event starts, so moving the event to or before a stored
  registration time is refused.

**Registration settings (SG2-63 AC8).** Registration capacity and its opening
and closing times belong to the Event Organiser
([Registrations](registrations.md)). The drawer shows them read-only, marked
"Set by the event organiser", and the planning route refuses a body carrying
any of them with 403 `{ error: 'Registration capacity and opening and closing
times are set by the Event Organiser.', fields }` before anything is read or
written. The coordinator still says whether registration is needed.

**Arrangement rechecks.** A later date or a higher expected attendance can
invalidate arrangements, but only arrangements that exist. The handler reads them through SG2-57's readiness data
(`fetchEventArrangementFacts` and `computeArrangementReadiness`, see
[Event arrangement readiness](event-arrangements.md)):

| Change | Flags | Only when the event has |
| --- | --- | --- |
| Proposed date moved, or expected attendance increased | `venue_recheck` | a live venue booking request (pending, placed by a hold, or approved) |
| Proposed date moved, or expected attendance increased | `equipment_recheck` | a live equipment request or an equipment reservation, including a legacy reservation without a linked request |

If anything is flagged and the request lacks `confirm_impact: true`, the server
answers 409 with `affected_arrangements` and `impact_notes`, and the drawer
shows exactly those as **Arrangements Require Rechecking** before saving. A
confirmed save marks them outstanding (`arrangements_recheck_needed`,
`outstanding_arrangements`) and keeps the event in `planning`. An edit to an
event with nothing arranged (for example an approved event with no venue
request yet) saves at once and marks nothing outstanding; an `approved` event
still moves to `planning`. If the arrangements cannot be read the edit is not
saved (503).

**Confirmed and Preparation events (SG2-66 AC6).** Once an event is
`confirmed` or in `preparation`, its details change only through a change
request (SG2-64). The handler compares the body with the stored record
(`computePlanningDiffs`, so values the drawer re-sends unchanged are not
edits) and refuses, before anything is written, any change other than
`registration_needed` and `planning_notes`: 409 `{ error, code:
'change_request_required', fields }`, where `error` is `This event is
<Confirmed|in Preparation>, so its details can no longer be edited directly.
Ask for the change through a change request instead; only whether registration
is needed and planning notes can still be edited here.` Registration capacity
and times stay the organiser's to change at any stage (SG2-63). Planning notes
stay editable because they are the coordinator's internal log, not event
details. The drawer shows a notice saying so, disables the date, attendance
and requirement fields, leaves them out of the save, and shows the server's
message if a refusal still comes back. `awaiting_safety_check` events keep the
full SG2-39 edit (AC6 names only Confirmed and Preparation).

**Back to Planning (SG2-66 AC7).** When a confirmed recheck moves an
`awaiting_safety_check` event to `planning` (a Confirmed or Preparation event
cannot reach a recheck on this route: its date and attendance are locked and
its registration capacity is the organiser's), the save records the status
change in the history
and tells the organiser and the assigned coordinator with an
`event_returned_to_planning` notice (see [Notifications](notifications.md)).
If the notices cannot be stored the request answers 503 while the saved edit
stands, as for the other notice paths. An `approved` event moving to
`planning`, or an event already in `planning`, sends no notice.

Legacy reservations still commit stock even when they have no equipment request.
The facts reader checks for a reservation belonging to the event, so changing its
date or increasing attendance also asks the coordinator to confirm an equipment
recheck. No reservation quantities, periods or identities are exposed by this
check; the saved receipt remains visible in the equipment reservations panel.

**Next step.** While an assigned event is `approved` or `planning`, its detail
shows **Next step — Find venues for this event**, so a planning save that moves
the event to `planning` keeps the step. Existing venue booking requests do not
hide it: an event may need several venues, or a new request after a release or
rejection. The step is not offered once the event has moved past planning.

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
to these queue records. Staff reach them only through the nav **Preview** menu,
which labels them as sample data, so they are not mistaken for the live queue.
Event cards show the client organisation, not a repeat of the event title. Until real requests are created, those staff dashboards
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
494 backend, 427 frontend and 19 reviewer tests, with **100% per-file statements,
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

Hosted CI for PR #39 (head `9ab83aa`, 23 September 2026) passed every job,
including the browser journeys and the SQL suites in native PostgreSQL 17:
[run 35808277040](https://github.com/tayelroy/Team2-SPM/actions/runs/35808277040).
