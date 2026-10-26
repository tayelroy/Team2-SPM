# Change impact (SG2-66)

"Be shown what a change would break." When the assigned Event Coordinator opens a
change request for an event, they see which arrangements it affects and why. Accepting
it marks those arrangements outstanding and, for an event that had moved on, returns
it to Planning until each one is rechecked and settled.

The other SG2-66 rules are documented with the features they change:

- AC5, Venue Staff-only capacity exceptions (including booked venues outgrown by a revised
  attendance): [venue holds](venue-holds.md) and the capacity-exception sections of
  [the API specification](design/api-specification.md);
- AC6, the direct-edit lock on Confirmed and Preparation events (whether registration is
  needed and planning notes excepted; registration capacity and times are the organiser's,
  see [registrations](registrations.md)), and AC7 on that path: [work queue](work-queue.md) and
  [notifications](notifications.md).

## Where change requests come from (SG2-64)

Organisers raise change requests through SG2-64 (see [change requests](change-requests.md)),
stored in `event_change_requests`. Deciding on one with a refusal is SG2-65. The handlers
read them through one interface:

```ts
interface ChangeRequestSource {
  list(event): Promise<ChangeRequest[]>;         // pending requests, oldest first
  get(event, id): Promise<ChangeRequest | null>; // null when unknown or accepted
  markAccepted(event, id): Promise<void>;
}
```

The production `source` is `createDatabaseChangeRequestSource`
(`server/src/db/changeRequests.ts`); accepting marks the request `accepted`. The in-memory
mock in `server/src/changeRequests/mockChangeRequests.ts` is now only a test fixture: the
unit tests and the e2e change-impact and safety-approval journeys opt their events in to it
(`e2e/support/change-requests.ts`), so their ids stay stable. Per process, it seeds three
requests per event on first read and then freezes them (accepted ones are hidden):

| id | change | significant |
| --- | --- | --- |
| `mock-<id>-attendance` | expected attendance + max(20, 50%), or 100 when unknown | yes |
| `mock-<id>-date` (only when the event has a date) | proposed date + 7 days | yes |
| `mock-<id>-description` | description + " (updated agenda)" | no |


## Significant changes (AC1)

Changes to `proposed_date`, `expected_attendance`, `venue_requirements`,
`accessibility_needs` or `equipment_requirements` are significant: every arrangement the
event has is listed for revalidation. `name`, `purpose` and `description` can be changed
by a change request but are **not** significant (team decision): they cannot invalidate
a booking, reservation or registration, so accepting such a change rechecks nothing.
The lists live in `server/src/events/changeImpact.ts` and are mirrored in the SQL
whitelist of `apply_accepted_event_change`.

Listed arrangements, in this order:

- `venue_booking`: each confirmed venue booking;
- `venue_request`: each pending venue booking request (no booking yet);
- `equipment_reservation`: each equipment reservation;
- `equipment_request`: each live (not rejected or cancelled) equipment request not yet reserved;
- `registrations`: one item when registration is needed or the event has registrations
  (cancelled ones are not counted).

Each item's reasons:

- `revalidate` (AC1) on every item of a significant change;
- `capacity_check` (AC2) on venue items when the new attendance is above the venue's
  capacity (an unknown capacity never fits) and no Venue Staff capacity exception on that
  item's booking request covers at least the new attendance. Only Venue Staff can approve
  that exception (AC5; exceptions recorded by other roles are ignored);
- `period_recheck` (AC3) on venue and equipment items when the date changes, giving the
  booked period and the new start.

Times in reasons and blockers are Singapore time (`20 Jun 2030 10:00 SGT`), the same
wording the database notices use.

`outstanding_arrangements` maps the listed kinds to SG2-39's recheck keys:
venue → `venue_recheck`, equipment → `equipment_recheck`, registrations →
`registration_recheck`.

## Accepting a change (AC4, AC7)

The server re-reads the event and its arrangements, recomputes the impact (the client is
never trusted), checks the planning schedule rules, then calls
`public.apply_accepted_event_change` with the service role. In one transaction under the
event row lock it:

1. refuses as stale when the status or the assigned coordinator changed since the read;
2. applies only the whitelisted fields and records each changed field, plus one
   `change_request` history row (`Accepted change request <id>`);
3. when arrangements are affected: sets `arrangements_recheck_needed` and appends the new
   keys to `outstanding_arrangements` (existing order kept). `confirm_event` already
   refuses while any recheck key is outstanding, so every check runs again before the
   event can be confirmed;
4. moves Awaiting Safety Check, Preparation and Confirmed events back to Planning,
   clears `confirmed_by`/`confirmed_at`, records the status change, and notifies
   (`event_returned_to_planning`) the organiser and the assigned coordinator. An Approved
   event moves to Planning as its normal next step, without a notice. A Planning event
   stays in Planning.

**Safety approval withdrawal (SG2-94 AC3).** A significant change (date and time,
attendance, venue, accessibility or equipment requirements) to an event in Preparation or
Confirmed always returns it to Planning, even when no recheck was named, and its approval
no longer counts: `202610220001_safety_approval_gate.sql` replaces
`apply_accepted_event_change` to add a `safety_approval` history row ("Withdrawn: …")
when the event held an approval, and the event must pass the safety check again before
Preparation. The decision history in `event_safety_decisions` is never rewritten. See
[Safety checks](safety-checks.md).

**The coordinator is notified too.** The usual rule is that nobody is told about their own
action, but AC7 names both the organiser and the assigned coordinator, so the coordinator
who accepted the change also gets a notice (one per person if they are the same account).
Wording (SQL and `eventNoticeMessages` match):

- organiser: `<event> has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.`
- coordinator: `<event> is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.`

## Settling a recheck (AC4)

The coordinator marks each outstanding key rechecked. The server refuses with the reasons
while its arrangements still fail:

- `venue_recheck`: every confirmed booking and pending venue request covers the event start
  (`starts_at <= proposed_date < ends_at`) and fits the attendance (capacity, or a Venue
  Staff exception for at least that attendance);
- `equipment_recheck`: every live equipment request and every dated reservation covers the
  event start;
- `registration_recheck`: when registration is needed, it closes before the event starts
  and holds no more registrations than its capacity.

Then `public.settle_arrangement_recheck` removes the key under the event lock, clears
`arrangements_recheck_needed` when it was the last, and records an `arrangement_recheck`
history row (`<key> settled`).

## API

All three are for the event's assigned Event Coordinator (`event_request.change_request.view`,
`event_request.change_request.accept`, `event_request.rechecks.settle`); anyone else gets
403, and another coordinator's event is a 404.

| route | result |
| --- | --- |
| `GET /api/event-requests/:eventId/change-requests` | `{ source: 'mock', event, can_accept, change_requests: [{ id, requested_at, reason, status, changes, significant, impact }] }` |
| `POST /api/event-requests/:eventId/change-requests/:id/accept` | 200 `{ event_id, previous_status, status, returned_to_planning, arrangements_recheck_needed, outstanding_arrangements }`; 404 unknown or accepted request; 409 status cannot change or stale; 400 `Invalid change` with schedule details |
| `POST /api/event-requests/:eventId/rechecks/:key/settle` | 200 `{ event_id, arrangements_recheck_needed, outstanding_arrangements }`; 400 unknown key; 409 not outstanding, stale, or `blockers` |

`can_accept` is true while the event is Approved, Planning, Awaiting Safety Check,
Preparation or Confirmed.

## Database

Migration `supabase/migrations/202610190003_event_change_impact.sql` adds the notice kind
and both functions (`security definer`, empty `search_path`, executable by
`service_role` only). `supabase/tests/event_change_impact.sql` proves acceptance from each
stage, the cleared confirmation, the outstanding union, the history rows, the exact
notices, the whitelist, stale refusals, settling and the grants.
