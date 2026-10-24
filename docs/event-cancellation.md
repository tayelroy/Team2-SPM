# Event cancellation (SG2-67)

The Event Organiser asks for a cancellation with a reason, and only the assigned
Event Coordinator carries it out. Cancelling frees the event's venues and
equipment, tells its registered attendees, and is final.

## Endpoints

| Method and path | Who | Body | Outcomes |
| --- | --- | --- | --- |
| `POST /api/event-requests/:eventId/cancellation-request` | the organiser who created the event (`event_request.cancellation.request`) | `{ "reason": "…" }` (1–500 characters after trimming) | 201 requested; 400 no valid reason; 404 not their event; 409 `closed` (draft, completed or cancelled) or `requested` (already asked) |
| `PATCH /api/event-requests/:eventId/cancel` | the assigned coordinator (`event_request.cancel`) | none | 200 cancelled, with `bookings_released` and `attendees_notified`; 404 not their event; 409 `not_requested` or `closed` |

Every other role gets 403 from the route permission, and the database rechecks
the acting role (SG2-104). The event detail (`GET /api/event-requests/:eventId`)
now includes `cancellation_requested_at`, `cancellation_reason` and
`cancelled_at` for the organiser. Coordinators open their events from the work
queue, whose event details now carry `cancellation_requested_at` and
`cancellation_reason`. The Cancellation panel shows the organiser's "Ask to
cancel" form on the event page, and the coordinator's "Cancel event" step,
with a confirmation, in the work queue. A cancelled event leaves the
coordinator's queue.

## Migration `202610220002_event_cancellation.sql`

- `events` gains `cancellation_requested_at`, `cancellation_requested_by`,
  `cancellation_reason`, `cancelled_at` and `cancelled_by`, with checks that a
  request always has a reason of at most 500 characters and that a
  cancellation time is only stored on a cancelled event.
- A rejected event cannot be asked about or cancelled: it will not happen anyway.
  The database is the authority here; `STATUS_TRANSITIONS` in
  `server/src/events/fields.ts` lists the organiser's own edit transitions.
- `request_event_cancellation(event, reason)` records the request, adds a
  `cancellation_request` history entry, and sends the assigned coordinator a
  `cancellation_requested` notice. An event still waiting for a coordinator
  keeps the request for whoever is assigned.
- `cancel_event(event)` locks venue, then booking, then event (the order
  `release_venue_booking()` uses). It then:
  - releases every held or confirmed booking that has not ended, with the
    reason `Event cancelled: <reason>`, and cancels the approved request
    behind each one (as SG2-51 does);
  - releases every tentative hold, cancelling its request and adding a
    `venue_hold_status` history entry (as `change_venue_hold()` does), so
    another event can book the slot;
  - cancels the event's other pending venue and equipment requests, so they
    leave the Venue Staff and Technical Support queues;
  - sets the status to `cancelled`, so SG2-56's trigger releases the equipment;
  - records who cancelled and when, plus `venue_booking` and `status` history
    entries;
  - sends `event_cancelled` to every registered attendee (registrations not
    cancelled) and to the organiser, in the SG2-69 inbox.
- The `keep_cancelled_events_cancelled` trigger refuses any later status
  change on a cancelled event, whoever makes it (AC5).
- Two notification kinds are added: `cancellation_requested` and
  `event_cancelled`.
- `internal_work_items` is replaced from SG2-105's latest definition
  (`202610200001_event_preferred_layout.sql`) with only the two cancellation
  fields added to the event details.

Teammates' suites that cancelled an event in a fixture and then set it back now
check the cancelled stage last (`event_confirmation.sql`), inside a block that
is undone (`equipment_reservations.sql`, `notification_inbox_reminders.sql`), or
switch off only the AC5 trigger for their fixture reset (the two concurrency
scripts). `event_cancelled` is now a real notification kind, so the made-up kind
in `event_notifications.sql` and `notificationsApi.test.ts` is `event_postponed`.

Tests: `supabase/tests/event_cancellation.sql` (in the CI database job),
`server/src/eventCancellation.test.ts`, `server/src/db/eventCancellation.test.ts`,
`client/src/components/CancellationPanel.test.tsx`,
`client/src/api/eventCancellation.test.ts`,
`client/src/screens/EventDetail.cancellation.test.tsx` and
`client/src/screens/WorkQueue.cancellation.test.tsx`.

Not included: a coordinator "decline the request" action.
