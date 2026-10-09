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
  **approved** `venue_booking_requests` row and none still `pending`. Outstanding
  when nothing has been requested yet, or any request is still awaiting a
  decision. Rejected and cancelled requests are ignored. An event may need
  several bookings (Week 7 change #3); all live ones must be approved.
- **Equipment** — `not_required` when the event has no live `equipment_requests`.
  Otherwise ready only when **every** live request has been *arranged* by
  Technical Support (a placement recorded) with **no remaining shortfall**
  (`placement_venue_id` set and `shortfall = 0`). SG2-53 is explicit that an
  equipment request "describes need; it neither reserves equipment nor promises
  stock", so there is no "reserved" status to read — arrangement with zero
  shortfall is the in-place signal.
- **Registration** — `not_required` when `registration_needed` is not true.
  Otherwise ready only when capacity, opening time and closing time are all set;
  the detail names whichever are missing.

`ready_for_confirmation` is true exactly when nothing is outstanding. Because
SG2-100 inserted **Safety Check** and **Preparation** between Arrangements and
Confirmed, this flag means "arrangements complete, ready to leave the
Arrangements step" — not "one click from Confirmed". The confirmation transition
and its own gating belong to SG2-58.

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
    { "key": "equipment", "label": "Equipment", "state": "outstanding", "detail": "1 equipment request not yet arranged or with a shortfall." },
    { "key": "registration", "label": "Registration", "state": "not_required", "detail": "Registration not required." }
  ],
  "outstanding": ["equipment"],
  "ready_for_confirmation": false
}
```

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
