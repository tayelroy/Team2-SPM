# Notifications (SG2-68)

People are told when something affects an event they take part in. Every
notice is a row in `public.notifications` and appears in the bell in the app
header (`client/src/components/HoldNotifications.tsx`), which shows a label for
the kind (what happened), the message (which names the event) and the stored
`created_at` in Singapore time (when) — SG2-68 AC2.

## Who can read notices

`GET /api/notifications` needs `notifications.read`: Event Coordinator, Venue
Staff, Technical Support Staff, Event Organiser and, since SG2-68, the Event
Coordinator Lead (see [authorization](authorization.md)). Rows are limited to
the caller twice: the handler filters on `recipient_id`, and the
`notifications` RLS policy lets a recipient read only their own rows. Nobody
else's notice can be read, so a person with no part in an event never sees one
about it (AC3). The Safety Officer receives no notices yet and has no grant.

The Event Organiser's and the Lead's bells show these notices only; the
internal roles' bells also show tentative-hold notices (SG2-84/85,
`venue_hold_notifications`), which are a separate table and are not covered
here.

## Every kind

Every message names the event as `coalesce(nullif(name, ''), 'Untitled event')`
(at most 500 characters of the name in the app). Messages are at most 2000
characters. Nobody is told about their own action, and one person gets one
notice of a kind per action even if they hold two parts in the event.

| Kind | Bell label | Trigger | Recipients | Message | Written by |
| --- | --- | --- | --- | --- | --- |
| `event_submitted` | Event submitted | Submit or resubmit lands in `unassigned` | Every `event_coordinator_lead` | `<Event> was submitted and is waiting for a coordinator.` | `server/src/events/submit.ts` |
| `event_submitted` | Event submitted | Resubmit lands in `submitted` (the event already has a coordinator) | The event's coordinator | `<Event> was resubmitted for your review.` | `server/src/events/submit.ts` |
| `coordinator_assigned` | Coordinator assigned | First assignment or reassignment (re-choosing the current coordinator changes nothing and notifies nobody) | New coordinator | `You are now coordinating <Event>.` | `server/src/events/assignCoordinator.ts` |
| | | | Organiser | `<Coordinator name> is now coordinating <Event>.` (`A coordinator` if the name is unknown) | |
| | | | Previous coordinator (reassignment only) | `<Event> was reassigned to another coordinator.` | |
| `clarification_requested` | Question from your coordinator | The assigned coordinator posts while the event is `under_review`, returning it (`→ needs_clarification`). Follow-ups and the organiser's answers notify nobody. | Organiser | `Your coordinator has a question about <Event>.` — the question itself stays in the clarification thread | `server/src/events/clarifications.ts` |
| `event_approved` | Event approved | `under_review → approved` | Organiser | `<Event> was approved.` | `server/src/events/decide.ts` |
| `event_rejected` | Event not approved | `under_review → rejected` | Organiser | `<Event> was not approved: <reason>` (the stored reason, cut so the message fits 2000 characters) | `server/src/events/decide.ts` |
| `venue_request_approved` / `venue_request_rejected` | Venue request approved / rejected | Venue Staff decide a venue booking request (SG2-49) | Coordinator (SG2-49) and, since SG2-68, the organiser unless they are that coordinator | `<Venue> was approved for <Event>.` / `<Venue> was rejected for <Event>: <reason>` | `public.decide_venue_booking_request` |
| `venue_request_approved` | Venue request approved | Venue Staff convert a tentative hold into a booking (SG2-84) | Organiser (SG2-68) | `<Venue> was approved for <Event>.` | `public.change_venue_hold(…, 'convert')` |
| `venue_booking_released` | Venue booking released | A confirmed booking is released (SG2-51) | Coordinator and organiser | `<Venue> was released for <Event> (<period> SGT): <reason>` | `public.release_venue_booking` |
| `equipment_reserved` | Equipment reserved | Technical Support reserve equipment (SG2-55) | Coordinator | receipt naming the equipment and event | equipment reservation RPC |
| `venue_booking_clash` | Booking clash flagged | A booking newly clashes once setup and turnaround apply (SG2-79) | Each affected event's coordinator | names both bookings and periods | `public.refresh_venue_booking_clashes` |
| `venue_unavailable` | Venue unavailable | A confirmed booking is flagged because its venue was marked unavailable (SG2-81) | The affected event's coordinator and, when the event moved back to Planning, its organiser | the venue, the period (SGT), the reason, and the booking or event affected | `public.venue_disruption_notify` |
| `event_confirmed` | Event confirmed | The coordinator confirms the event (SG2-58) | Organiser | `Your event <Event> is confirmed.` | `public.confirm_event` |

The SG2-68 event-request notices are written by the API with the service-role
client (`notifyEvent` and `fetchLeadIds` in
`server/src/db/eventNotifications.ts`), injected into each handler like its
history write. They carry `event_id` and no `request_id`. The venue notices are
written inside the SQL functions, in the same transaction as the decision, with
`on conflict (request_id, recipient_id, kind) do nothing`, so a replayed
decision adds nothing.

## Failure behaviour

Each API path writes its notices after the transition and its SG2-40 history
row, as a separate call (not a transaction):

- If the history row cannot be written, no notice is sent and the path behaves
  as before (assignment is undone; the others answer 503).
- If the Lead list (submit) cannot be read or the notices cannot be stored, the
  request answers **503** with the path's usual "temporarily unavailable"
  message and no provider detail. The transition and its history row stand;
  assignment is **not** undone for a notice failure. Retrying is refused (the
  transition already happened), so the notice is lost. This is the same known
  gap as the history write's (see
  [organisation events](organisation-events.md#event-change-history-sg2-40)).

The SQL-written notices commit or roll back with their decision.

## Out of scope (dependencies)

SG2-68 AC1 also lists two triggers with no code path yet. They will add their
own kinds when built:

- **A significant change is accepted** — SG2-64 / SG2-65.
- **An event is cancelled** — SG2-67.

## Rollout

Migration `supabase/migrations/202610160001_event_notifications.sql` rebuilds
`notifications_kind_check` with every existing kind plus `event_submitted`,
`coordinator_assigned`, `clarification_requested`, `event_approved` and
`event_rejected`, and redefines `decide_venue_booking_request` and
`change_venue_hold` with the organiser notice added. It must be applied before
the API that writes the new kinds is deployed: until then the constraint
refuses those inserts and submit, assignment, clarification and decision would
answer 503. The SQL suite is `supabase/tests/event_notifications.sql`.

## Tests

- Server: `server/src/db/eventNotifications.test.ts` and the handler suites
  (`submitEventRequest`, `assignCoordinator`, `clarifications`,
  `decideEventRequest`, `notifications`, `authorization`).
- Client: `client/src/api/notificationsApi.test.ts`,
  `client/src/components/HoldNotifications.test.tsx`.
- Browser: `e2e/event-notifications.spec.ts` (SG2-68-P01…P06, N01, B01, F01 in
  [the regression register](regression-cases.json)). The in-memory fixtures
  `e2e/support/venue-decisions.ts` and `e2e/support/venue-holds.ts` mirror the
  organiser notices of the two SQL functions.
