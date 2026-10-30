# Event confirmation (SG2-58)

The assigned Event Coordinator confirms an event once every required
arrangement is in place. The event becomes **Confirmed**, the Event Organiser
is notified, and the organiser (and the coordinator) can see the confirmed
arrangements. A confirmed event that needs registration is open for attendees
to register during its registration period.

## Rules

Product-owner decisions (binding):

1. Only an event in **Preparation** can be confirmed (SG2-100
   `STATUS_TRANSITIONS`: `preparation → confirmed`). SG2-94 AC5: an attempt on
   an event still in Approved, Planning, Awaiting Safety Check or Safety
   Rejected is refused with `outstanding`, the safety check included; every
   other status is refused with `closed`, including a second confirmation of
   the same event.
2. The readiness gate is exactly SG2-57's readiness, tightened so equipment
   must be **reserved and placed** (see
   [Event arrangement readiness](event-arrangements.md)):
   - **Venue** — outstanding if the event has no `venue_booking_requests`
     other than cancelled ones, if any is still `pending` or `rejected`, or if
     any `approved` one no longer has a **confirmed**
     `venue_bookings` row linked to it. A booking is linked through the
     request's `venue_booking_id` or through a `venue_holds` row for the
     request (`venue_holds.request_id`) whose `booking_id` it is: converting a
     tentative hold records the booking on the hold only, and releasing that
     booking leaves the request `approved`. One pending, rejected or unbooked
     request among several approved ones blocks confirmation. SG2-82 AC5
     (every venue the event needs must be approved): a rejected request still
     counts until the coordinator withdraws it, which cancels it
     (`withdraw_venue_booking_request()`; migration
     `202610150003_confirm_event_rejected_venues.sql` replaced the gate's
     venue check). A booking released under SG2-51 also cancels its request.
   - **Equipment** — with no live `equipment_requests`, not required only if
     the organiser asked for none (`equipment_requirements` not set or `None`,
     `public.event_equipment_needed()`, SG2-57 migration
     `202610290001_requested_equipment_outstanding.sql`); otherwise outstanding
     until it is requested. With live requests, outstanding if any lacks an
     `equipment_reservations` receipt with its `request_id`, has no
     `placement_venue_id`, or has a `shortfall` other than 0.
   - **Registration** — not required unless `registration_needed` is true.
     SG2-94 AC6: unset capacity or times no longer block (the Event
     Organiser sets them under SG2-63); only an outstanding
     `registration_recheck` (SG2-66) does.
   - **Safety check** (SG2-94 AC4/AC5) — outstanding unless the event is in
     Preparation or Confirmed and its latest safety decision is Approve
     (`public.event_safety_approved`; see [Safety checks](safety-checks.md)).

   Outstanding keys are always reported in the order `venue`, `equipment`,
   `registration`, `safety`. Not-required arrangements never block. The
   TypeScript computation (`server/src/events/arrangementReadiness.ts`) and
   the SQL gate in `confirm_event` (latest:
   `202610220001_safety_approval_gate.sql`) must stay identical.
3. AC3 is a rule, not a registration feature: registration is **open** when
   the event is `confirmed`, `registration_needed` is true and
   `registration_opens_at <= now < registration_closes_at`
   (`server/src/events/registrationWindow.ts`). The reported states are
   `not_required`, `not_confirmed`, `not_yet_open` (before opening, or a time
   is missing), `open` and `closed` (at or after closing, or the event has been
   completed). SG2-60 builds attendee registration on this rule.

## Transaction

`public.confirm_event(p_event_id integer) returns jsonb` (migration
`202610150001_event_confirmation.sql`) runs as `security definer` under the
caller's JWT. It rechecks the caller's stored role in `account_roles`
(anyone but `event_coordinator` is refused with `42501`), locks the event row
`FOR UPDATE`, and returns `missing` for an event that does not exist or is
assigned to another coordinator. After the lock it reads the venue, equipment,
registration-recheck and latest safety decision facts and either returns the outstanding list with no writes
or, in one transaction, sets `status = 'confirmed'`, `confirmed_by`,
`confirmed_at`, writes a `status` audit row (`preparation → confirmed`) and one
`event_confirmed` notification to the organiser. Every writer of venue
requests, bookings, equipment requests and reservations already locks the
event row first, so confirmation is serialised against them.

## API

`PATCH /api/event-requests/:eventId/confirm` — permission
`event_request.confirm` (Event Coordinator). No body. The server calls the RPC
with the caller's token; it never decides readiness itself.

| Outcome | Status | Body |
| --- | --- | --- |
| ok | 200 | `{ "event_id": 7, "status": "confirmed", "confirmed_at": "<iso>", "organiser_notified": true }` |
| missing | 404 | `{ "error": "No event in preparation is assigned to this account." }` |
| closed | 409 | `{ "error": "Only an event in Preparation can be confirmed.", "code": "closed" }` |
| outstanding | 409 | `{ "error": "Confirmation refused: arrangements are still outstanding.", "code": "outstanding", "outstanding": ["venue", "equipment", "registration", "safety"] }` |

Invalid ids return 400. A refused role (route grant or the RPC's `42501`)
returns 403, an expired session 401, and any other provider failure 503 —
never database details.

`GET /api/event-requests/:eventId/confirmation` — permission
`event_request.confirmation.view` (Event Organiser, Event Coordinator), then
the caller must be the event's creating organiser or its assigned coordinator;
anyone else, and any event not `confirmed` or `completed`, receives the same
404. Rows are read with the service role after that check.

```json
{
  "event_id": 581,
  "status": "confirmed",
  "confirmed_at": "2026-10-11T08:00:00.000Z",
  "venues": [{ "venue_name": "Regression Hall", "starts_at": "2030-06-20T02:00:00.000Z", "ends_at": "2030-06-20T06:00:00.000Z" }],
  "equipment": [{ "equipment_type": "Wireless microphones", "quantity_reserved": 12 }],
  "registration": { "needed": true, "capacity": 120, "opens_at": "2026-01-01T00:00:00.000Z", "closes_at": "2030-06-19T16:00:00.000Z", "window": "open" }
}
```

Venues are the event's `venue_bookings` with status `confirmed`, in start
order; equipment is every reservation receipt for the event.

## UI

- **Coordinator** — in the Work Queue event detail, an event in Preparation
  shows a **Confirm event** action under the readiness panel. A double click
  sends one request. Success changes the status to confirmed and says
  "Event confirmed. The Event Organiser has been notified."; a refusal lists
  the outstanding items as Venue booking / Equipment / Registration.
- **Organiser** — the event detail of a confirmed or completed event shows a
  **Confirmed arrangements** section: venues with Singapore times, equipment
  as quantity × type, registration capacity, opening and closing times, and a
  plain-language window state. The notifications drawer shows the
  "Event confirmed" notice.

## Rollout

Apply `supabase/migrations/202610150001_event_confirmation.sql` before
deploying the server: the confirm route calls `confirm_event` and the
confirmation view reads `events.confirmed_at`. The migration adds nullable
`confirmed_by`/`confirmed_at` (with a paired check that existing rows satisfy),
extends `notifications_kind_check` with `event_confirmed`, and grants execute
on the RPC to `authenticated` only. Events already `confirmed` before the
migration show no "Confirmed at" time.

## Verification

- Server: `confirmEvent.test.ts`, `getEventConfirmation.test.ts`,
  `db/eventConfirmation.test.ts`, `events/registrationWindow.test.ts`, and the
  updated SG2-57 readiness and fact tests; policy grants in
  `authorization.test.ts`.
- Client: API reader, Work Queue confirm action, confirmed-arrangements
  section and the notification label.
- Browser: `e2e/event-confirmation.spec.ts` (SG2-58-P01/N01/N02/B01/C01/F01)
  against an in-memory mirror of the RPC (`e2e/support/event-confirmation.ts`);
  N02 converts a tentative hold, releases its booking and expects Confirm to
  be refused with Venue booking listed.
- Database: `supabase/tests/event_confirmation.sql` and
  `.github/scripts/test-event-confirmation-concurrency.mjs`.
