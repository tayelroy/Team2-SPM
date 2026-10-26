# Change requests (SG2-64)

After submitting, the Event Organiser asks for a change instead of editing the
request: what should change, to what, and why. The request reaches the assigned
Event Coordinator, and both see it on the event until it is decided (SG2-65).
What an accepted change breaks is [change impact](change-impact.md) (SG2-66).

## Endpoints

| Method and path | Who | Body | Outcomes |
| --- | --- | --- | --- |
| `POST /api/event-requests/:eventId/change-requests` | the organiser who created the event (`event_request.change_request.raise`) | `{ "field": "…", "to": …, "reason": "…" }` | 201 `{ change_request, coordinator_notified }`; 400 unknown field, invalid or blank value, or no reason (1–1000 characters after trimming); 404 not their event; 409 `closed` (draft, cancelled, rejected or completed, with the `status`) or the event already has that value |
| `GET /api/event-requests/:eventId/change-requests` | the creating organiser, or the assigned coordinator (`event_request.change_request.view`) | none | 200 the pending requests, oldest first. The organiser gets `{ event, change_requests }`; the coordinator also gets `can_accept` and each request's `significant` and `impact` (SG2-66). 404 for anyone else's event |

`field` is one of `name`, `purpose`, `description`, `proposed_date`,
`expected_attendance`, `venue_requirements`, `accessibility_needs` and
`equipment_requirements` (`CHANGEABLE_FIELDS` in
`server/src/events/changeImpact.ts`). The new value follows the request form's
own rules (`validateDraftInput` in `server/src/events/fields.ts`): text is
trimmed, attendance is a whole number of at least 1, and a date is stored as
an ISO instant. One request changes one field.

Every other role gets 403 from the route permission. The coordinator accepts a
request through SG2-66's `POST …/change-requests/:changeRequestId/accept`.

## Migration `202610260001_event_change_requests.sql`

- `event_change_requests` stores the event, who asked, the field, its value
  when asked (`from_value`), the new value (`to_value`), the reason and a status
  (`pending`, `accepted`, or `refused` for SG2-65). Checks keep the field
  in the changeable list, the reason 1–1000 characters, and the status known.
- RLS is enabled and forced with no policies, and `anon` and `authenticated`
  hold no grants: only the service role reads or writes it. The API decides who
  sees a request (AC3) and answers 404 to everyone else.
- `raise_event_change_request(event, actor, field, to, reason)`, service role
  only, checks the actor holds `event_organiser`, belongs to the event's
  organisation and created it, then locks the event row. The lock serialises
  the request with cancelling, completing and every status change, so the
  status it checks is the status the insert commits against. It refuses a
  draft, cancelled, rejected or completed event (`closed`, AC4) and a value
  equal to the current one (`unchanged`; a date compares as an instant). It
  stores the request and sends the assigned coordinator a `change_requested`
  notice in the same transaction (AC2). An event still waiting for a
  coordinator keeps the request for whoever is assigned.
- The notification kind `change_requested` is added to the existing list, as
  SG2-63 and SG2-67 did.

Rollback: `supabase/rollbacks/202610260001_event_change_requests_down.sql`
drops the function and the table (raised requests are lost; accepted ones stay
in the event history as `change request <id>`).

## No direct edits after submission (AC5, AC6)

`PATCH /api/event-requests/:eventId` now edits a draft only. While a request is
returned for clarification it answers 409 ("Ask for a change to a submitted
request through a change request"), replacing SG2-36 AC2 and the clarification
exception in SG2-30 AC3. The organiser answers in the clarification thread,
asks for any change on the event page, and uses **Resubmit for review** to send
the request back as it stands. My drafts no longer offers Edit on it. A
rejected request was already refused direct edits and can still be resubmitted
(AC6).

`update_event_request_draft` still accepts `needs_clarification`; only the
service role can call it, and the server refuses first.

## Client

The **Change requests** section on the event page, for the creating organiser
on a submitted event that is not cancelled, rejected or completed, lists the
outstanding requests (from → to, the reason and when it was asked) and asks
what should change, the new value and why. The coordinator's bell shows
`change_requested` as "Change requested", and SG2-66's panel lists the raised
requests.

## Verification

- `supabase/tests/event_change_requests.sql` (CI database job): open and
  closed statuses, the coordinator notice, owner checks, unchanged values,
  the 1000/1001-character reason boundary, the field whitelist, and that no
  signed-in or anonymous caller reads, writes or calls the function directly.
  Sabotage runs (a read policy for organisers; completed dropped from the
  closed list) made it fail.
- `server/src/changeRequestsRaise.test.ts`, `server/src/db/changeRequests.test.ts`
  and `server/src/updateEventRequestDraft.test.ts`.
- `client/src/components/OrganiserChangeRequests.test.tsx`,
  `client/src/api/organiserChangeRequests.test.ts` and
  `client/src/screens/EventDetail.changeRequests.test.tsx`.
- `e2e/change-requests.spec.ts` (SG2-64-P01, SG2-64-N01) against
  `e2e/support/change-requests.ts`, the loopback mirror of the function, and
  `e2e/draft-history.spec.ts` SG2-40-P03 for AC5.
