# Event arrangement readiness (SG2-57)

An Event Coordinator can see, for an event they are assigned, which of its
arrangements are in place and which still stand between it and confirmation.
Three arrangements are reported — the venue booking(s), any requested equipment,
and registration — each labelled **Ready**, **Outstanding** or **Not required**,
with a one-line detail. When every *required* arrangement is ready the event is
shown as **ready for confirmation**.

## What "ready" means per arrangement

The acceptance criteria predate two Week 7 changes (SG2-53 equipment, SG2-100
lifecycle), so the readiness signals are mapped onto the implemented model as
follows:

- **Venue booking** — always required. Ready when the event has at least one
  **approved** `venue_booking_requests` row, none still `pending`, and every
  approved one still has a **confirmed** `venue_bookings` row linked to it —
  through the request's `venue_booking_id`, or through the `booking_id` of a
  `venue_holds` row for the request (a converted tentative hold records its
  booking on the hold only). Outstanding when nothing has been requested yet,
  any request is still awaiting a decision ("N venue booking(s) still awaiting
  approval."), or an approved request's booking was released or otherwise is
  no longer confirmed ("N approved venue request(s) no longer have a confirmed
  booking."), checked in that order. Rejected and cancelled requests are
  ignored. An event may need several bookings (Week 7 change #3); all live ones
  must be approved and booked (SG2-58 review).
- **Equipment** — `not_required` when the event has no live `equipment_requests`.
  Otherwise ready only when **every** live request is both **reserved** (an
  SG2-55 `equipment_reservations` receipt with that `request_id`) and
  **placed** by Technical Support with **no remaining shortfall**
  (`placement_venue_id` set and `shortfall = 0`). This was tightened by SG2-58
  (product-owner decision): SG2-57 originally accepted placement alone, but
  AC1 asks whether requested equipment is *reserved*, and the confirmation
  gate must agree with this panel. A legacy reservation without a `request_id`
  reserves no request.
- **Registration** — `not_required` when `registration_needed` is not true.
  Otherwise ready only when capacity, opening time and closing time are all set;
  the detail names whichever are missing.

`ready_for_confirmation` is true exactly when nothing is outstanding. Because
SG2-100 inserted **Safety Check** and **Preparation** between Arrangements and
Confirmed, this flag means "arrangements complete" — the event still has to
reach Preparation before it can be confirmed. SG2-58's `confirm_event` RPC
re-applies exactly these three rules in SQL as its gate (see
[Event confirmation](event-confirmation.md)), so the panel and the Confirm
action never disagree; a change to one must be made to the other.

## API

`GET /api/event-requests/:eventId/arrangements` requires the
`event_request.arrangements.view` permission (Event Coordinator) and then that
the caller is the event's **assigned** coordinator; anyone else receives 403,
and the role grant alone does not reveal another coordinator's event. Invalid
ids return 400, a missing event 404, and storage failures 503 without database
details.

`200` body:

```json
{
  "event_id": 101,
  "arrangements": [
    { "key": "venue", "label": "Venue booking", "state": "ready", "detail": "1 venue booking approved." },
    { "key": "equipment", "label": "Equipment", "state": "outstanding", "detail": "1 equipment request not yet reserved and placed with no shortfall." },
    { "key": "registration", "label": "Registration", "state": "not_required", "detail": "Registration not required." }
  ],
  "outstanding": ["equipment"],
  "ready_for_confirmation": false,
  "venue_requested": true
}
```

`venue_requested` is true while the event has any live venue booking request
(pending — including one placed by a tentative hold — or approved, whether or
not its booking is still confirmed). A venue that is `outstanding` may have
nothing requested yet, a request awaiting a decision, or an approved request
whose booking was released; this flag tells the first apart from the others.
SG2-39 planning edits use the same
facts and computation to decide which arrangements need rechecking: a venue
recheck is only asked for when `venue_requested` is true (see
[Work queue](work-queue.md#coordinator-planning-edits-sg2-39)).
The internal facts also mark each venue request `booked` (a confirmed booking is
linked to it directly or through its converted hold), each equipment request
`reserved` (a receipt with its `request_id` exists) and record whether the
event has any equipment reservation at all. SG2-55 planning rechecks use the
latter, which includes legacy reservations without a linked request, even when
no live equipment request exists. None of these exposes booking, hold or
reservation rows in the readiness response.

The readiness facts are read with the service role
(`fetchEventArrangementFacts`), since the child tables are not client-readable
under RLS; the route checks the coordinator's assignment first. The pure
computation lives in `server/src/events/arrangementReadiness.ts` and has no
database or HTTP dependency.

## UI

The assigned coordinator sees the readiness panel on their **Work Queue** event
detail, through the same arrangement-through-confirmed status window as the
equipment requirements. The panel is informational: it stays silent while
loading and if the read fails, so a brief outage never crowds out the rest of
the event detail.

## Verification

Backend tests cover the pure readiness computation (every arrangement state and
the overall flag), the route's authorisation and error mapping, and the
service-role fact reads. Client tests cover the API reader, the presentational
panel, and the self-fetching section. No hosted Supabase is required; the route
tests use injected fetchers and the client tests stub the transport.
