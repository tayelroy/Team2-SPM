# Behaviour diagrams — sources (SG2-95)

Revision note: the original 14 Oct design described main `1d1e336`. This revision describes PR90 head `61416cc`, including merged PR92; it does not claim that PR90 is merged or that every Done criterion has passed hosted acceptance. Jira status was refreshed on 16 Oct 2026.

Sequences 1–4 are as of PR90 head 61416cc (16 Oct 2026); Sequence 5 and the status model are as of main b7e2b1a (26 Oct 2026, SG2-96). Files: `sequence-diagrams.drawio` (five pages) and `event-status-model.drawio`, edited in app.diagrams.net.

## Sequence 1 — availability and booking decision (SG2-78/79)
- `GET /api/venues/availability`: `server/src/venues/availability.ts` (`createAllVenuesAvailabilityHandler`, `getAllVenuesAvailability`), bands from `server/src/venues/preparation.ts`.
- `POST /api/venue-booking-requests/:requestId/decision`: `server/src/venues/bookingRequests.ts`; adapter `server/src/db/venueBookingDecisions.ts`.
- `decide_venue_booking_request`, `venue_preparation_gap`: `supabase/migrations/202610120002_setup_turnaround_checks.sql` (latest body `202610170001_venue_replacement.sql`).
- Clash flags: `202610140003_venue_booking_clashes.sql` (`refresh_venue_booking_clashes`, trigger `venue_bookings_refresh_clashes`); `GET /api/venue-clashes`: `server/src/venues/clashes.ts`, `server/src/db/venueClashes.ts`.

## Sequence 2 — venue temporarily unavailable (SG2-80/81, built)
- `POST /api/venues/:venueId/blocks`: `server/src/venues/blocks.ts`, `server/src/db/venueBlocks.ts`.
- Triggers `venue_unavailability_stamp`, `venue_unavailability_flag_bookings`, table `venue_booking_disruptions`, view `venue_affected_bookings`, RPC `list_venue_unavailability`: `202610100001_venue_temporary_unavailability.sql`.
- Client: `client/src/venues/VenueBlocks.tsx`, `blocksApi.ts`.
- Replacement uses existing `POST /api/venue-booking-requests` with optional `replaces_booking_id`, and existing `POST /api/venue-booking-requests/:requestId/decision`. API checks the reference is an affected confirmed booking of the same assigned event. There is no new replacement endpoint.
- `202610170001_venue_replacement.sql`: `venue_disruption_notify` notifies the current Coordinator on each new flag; Preparation/Confirmed returns to Planning, clears confirmation and records history, with an Organiser notice. Other event details and the original booking remain. Earlier flags are not retrospectively announced.
- Approval uses `decide_venue_booking_request` and internal `release_replaced_booking` in one transaction: create new confirmed booking, approve new request, release old booking/cancel its request, update the primary pointer and write history/notices. A pending replacement reserves nothing. General SG2-83 change/cancellation remains planned.
- Booking lists expose `affected_by` and pending `replacement`; arrangements count affected confirmed bookings. Final confirmation SQL `202610170002_confirmation_rechecks_and_disruptions.sql` keeps both disruption checks and persisted venue/equipment/registration rechecks. Client notification rendering supports `venue_unavailable` at 61416cc.

## Sequence 3 — tentative hold and expiry (SG2-84/85)
- `/api/venue-holds` routes: `server/src/venues/holds.ts`, `server/src/db/venueHolds.ts`.
- `create_venue_hold` (latest `202610120002_setup_turnaround_checks.sql`), `change_venue_hold` (latest `202610160001_event_notifications.sql`), `process_venue_hold_deadlines`, `expire_venue_hold`, `venue_hold_notice`, `venue_hold_settings.warning_lead_seconds` = 86400, pg_cron `venue-hold-deadlines` `* * * * *`: `202610050001_venue_holds.sql`.
- Hold notices go to `venue_hold_notifications`, not `notifications`.

## Sequence 4 — Lead assigns coordinator (SG2-87/97, SG2-68)
- `GET /api/assignment-queue`: `server/src/assignmentQueue/index.ts`, `server/src/db/assignmentQueue.ts` (`fetchUnassignedQueue`).
- `GET /api/event-requests/assignable`, `PATCH /api/event-requests/:eventId/coordinator`: `server/src/app.ts`, `server/src/events/assignCoordinator.ts`, `server/src/db/eventRequests.ts` (`assignEventCoordinator`, `COORDINATOR_ASSIGNABLE_STATUSES`), `server/src/db/eventNotifications.ts` (`notifyEvent`).
- Client: `client/src/screens/Dashboard.tsx`, `AssignmentQueue.tsx`, `CoordinatorAssignment.tsx`.

## Sequence 5 — safety check (SG2-91/92/93/94, built; redrawn 26 Oct 2026)
- Hand-off: `refresh_safety_check_status` and `safety_check_arrangements_ready` with the arrangement triggers (`202610190004_safety_check_queue.sql`); readiness also needs no outstanding recheck.
- Queue: `GET /api/safety-checks` (`server/src/safetyChecks/index.ts`, `server/src/db/safetyChecks.ts`, RPC `safety_check_queue`).
- Decision: `POST /api/event-requests/:eventId/safety-decision` (`server/src/events/safetyDecisionRoutes.ts`, `server/src/db/safetyDecisions.ts`, RPC `record_safety_decision`, latest body `202610240001_safety_changes_requested.sql`); `POST /:eventId/rework` → `rework_safety_rejected_event`.
- Changes sent back (SG2-93): `GET /api/safety-rereviews`, `POST /api/safety-rereviews/:reviewId/confirm` (`server/src/events/safetyRereviewRoutes.ts`, RPC `confirm_safety_rereview`, `private.settle_safety_rechecks`).
- Gate and confirmation (SG2-94): `safety_approval_gate` (`202610220001_safety_approval_gate.sql`); `PATCH /:eventId/confirm` → RPC `confirm_event`.
- End-to-end evidence: the last test in `integration/api.test.ts` drives submit → Lead assigns → two venues and equipment confirmed → safety check → Preparation → Confirmed against Postgres + PostgREST (SG2-96).

## Event status model — writer of each transition
| Transition | Writer at this snapshot |
|---|---|
| draft → unassigned; needs_clarification/rejected → unassigned | `PATCH /:id/submit` → `submitEventRequest` (`server/src/db/eventRequests.ts`) |
| needs_clarification/rejected → submitted (not in `STATUS_TRANSITIONS`; red edge) | `PATCH /:id/submit` → `submitEventRequest`, when a coordinator is already assigned |
| unassigned → submitted | `PATCH /:id/coordinator` → `assignEventCoordinator` with transition |
| submitted → under_review | `PATCH /:id/review` → `startEventReview` |
| under_review → needs_clarification | `POST /:id/clarifications` → `requestClarification` (`server/src/events/clarifications.ts`) |
| under_review → approved / rejected | `PATCH /:id/decision` → `decideEventRequest` |
| approved → planning | `PATCH /:id/planning` → `updateEventPlanningFields` (`server/src/events/updatePlanning.ts`) |
| approved / planning → awaiting_safety_check | trigger → `refresh_safety_check_status` once `safety_check_arrangements_ready` (SG2-91) |
| awaiting_safety_check → preparation / safety_rejected / planning | `POST /:id/safety-decision` → RPC `record_safety_decision` (SG2-92: Approve / Reject / Request Changes). SG2-94: the `safety_approval_gate` trigger refuses any other move into `preparation` |
| safety_rejected → planning | `POST /:id/rework` → RPC `rework_safety_rejected_event` (SG2-92 AC4, the assigned coordinator) |
| preparation → confirmed | `PATCH /:id/confirm` → RPC `confirm_event`, which since SG2-94 also needs the latest safety decision to be Approve |
| preparation / confirmed → completed | `PATCH /:id/complete` → `completeEvent` |
| awaiting_safety_check → planning | `PATCH /:id/planning` → `updateEventPlanningFields` on an edit with arrangement impact; SG2-92's Request Changes decision |
| preparation / confirmed → planning (now in `STATUS_TRANSITIONS`, SG2-81) | `venue_disruption_notify` on a new affected-booking flag (202610170001), `PATCH /:id/planning` on an edit with arrangement impact, or `apply_accepted_event_change` for an accepted significant change (15 Oct clarification, SG2-66) |
| draft, planning, awaiting_safety_check, safety_rejected, preparation, confirmed → cancelled | `POST /:id/cancel` → RPC `cancel_event` (SG2-67, the assigned coordinator after the organiser's request); SG2-56 releases equipment on cancellation |

## Code vs brief / table mismatches
- `submitEventRequest` also writes `needs_clarification → submitted` and `rejected → submitted` when a coordinator is already assigned. `STATUS_TRANSITIONS` does not list these.
- Draft removal is a `DELETE`; cancellation is `cancel_event` (SG2-67). `preparation` is reached only through an Approve safety decision (SG2-92/94).
- Handlers do not call `canTransition()`; `STATUS_TRANSITIONS` is used only in `fields.test.ts` and documents the intended flow. `updatePlanning.ts` refuses only `cancelled`/`completed`/`rejected` (L472) and sets `status = 'planning'` on any edit with arrangement impact (L504–509). `updateEventPlanningFields` filters the write on `event_id` + `coordinator_id` only. So any non-terminal event (incl. `submitted`, `under_review`, `needs_clarification`, `safety_rejected`) returns to `planning` on such an edit. The diagram draws only the preparation/confirmed edges, plus a note covering the rest.
- SG2-88 (assign/reassign as Lead) is Done in the 16 Oct Jira snapshot; `PATCH /:id/coordinator` supplies assignment/reassignment. This status does not substitute for per-criterion hosted acceptance.
- SG2-80 originally only flagged affected bookings. SG2-81 adds `venue_unavailable` notices on new flags and the Preparation/Confirmed return to Planning; the availability calendar still reads `venue_affected_bookings`.
