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

Every other role gets 403 from the route permission. The coordinator accepts or
refuses a request ([SG2-65](#deciding-on-a-change-request-sg2-65)).

## Migration `202610260001_event_change_requests.sql`

- `event_change_requests` stores the event, who asked, the field, its value
  when asked (`from_value`), the new value (`to_value`), the reason and a status
  (`pending`, `accepted` or `refused`; SG2-65 adds who decided, when and why). Checks keep the field
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

## Deciding on a change request (SG2-65)

The assigned Event Coordinator accepts or refuses each pending request.

| Method and path | Who | Body | Outcomes |
| --- | --- | --- | --- |
| `POST /api/event-requests/:eventId/change-requests/:changeRequestId/accept` | the assigned coordinator (`event_request.change_request.accept`) | none; `{ "next": "review" \| "resubmit" }` on a request returned for clarification | 200 the event's status and recheck state; 400 a missing or unknown `next` on a clarification request; 404 not their event or no such pending request; 409 a closed status, or decided in the meantime |
| `POST /api/event-requests/:eventId/change-requests/:changeRequestId/refuse` | the assigned coordinator (`event_request.change_request.refuse`) | `{ "reason": "…" }` | 200 `{ event_id, change_request_id, status: "refused" }`; 400 no reason (1–1000 characters after trimming); 404 not their event or no such pending request; 409 decided in the meantime |

- **AC1, accept:** on Approved, Planning, Awaiting Safety Check, Preparation
  or Confirmed, SG2-66's `apply_accepted_event_change` applies the change
  first (and returns a significant change on a Confirmed or Preparation event
  to Planning, AC5). The decision is then recorded and the organiser gets a
  `change_accepted` notice.
- **AC2, refuse:** a reason is required, the event is not touched, the
  history records "Refused change request <id>: <reason>", and the organiser
  gets a `change_refused` notice with the reason.
- **AC3, the record:** `event_change_requests` now has `decided_by`,
  `decided_at` and `decision_reason` next to the request itself. Checks keep
  the record whole: a pending request has neither decider nor time, a
  decided one has both, and a refusal has a 1–1000 character reason.
- **AC4, returned for clarification:** the event is still a request, so
  accepting writes the change straight onto it (with its history line) and
  the coordinator chooses **Accept and return to review** (`under_review`) or
  **Accept and ask organiser to resubmit** (stays `needs_clarification`; the
  organiser uses Resubmit for review). SG2-66's apply is not used here. The
  list route returns `next_step_required: true` for such an event.

### Migration `202610270001_change_request_decisions.sql`

- Adds the three decision columns and their checks. Requests SG2-66 accepted
  before this migration take their decider and time from the history line
  `apply_accepted_event_change` wrote (there were none on live on 26 Oct 2026).
- Adds `change_accepted` and `change_refused` to the notification kinds, as
  SG2-64 did.
- `decide_event_change_request(event, request, actor, decision, reason, next)`,
  service role only, locks the event (the same lock SG2-66's apply takes),
  checks the actor is its coordinator and the request is still pending,
  records the decision and notifies the organiser in one transaction.
  Outcomes: `ok` (with the event's status), `not_found`, `not_pending`,
  `invalid`.
- Accepting on an open status is two steps (SG2-66 applies, then this
  records). Once the change is applied, its history line "Accepted change
  request <id>" is written under the event lock, and the function refuses
  any later refusal of that request (`not_pending`), so an applied change can
  never be recorded as refused.

Rollback: `supabase/rollbacks/202610270001_change_request_decisions_down.sql`
drops the function and the three columns. Who decided, when and why are lost;
the history keeps every decision, and the two notification kinds stay allowed
so notices already sent remain valid.

### Client

SG2-66's Change requests panel gains **Refuse change**, which opens a
required "Reason for refusing" box (up to 1000 characters) with **Confirm
refusal** and **Cancel**. On a request returned for clarification, the single
Accept button is replaced by the two AC4 choices. The bell shows
`change_accepted` as "Change accepted" and `change_refused` as "Change
refused".

### Verification (SG2-65)

- `supabase/tests/change_request_decisions.sql` (CI database job): refusal
  record and notice, the 1000/1001-character and blank reason boundary,
  accepting after SG2-66's apply, AC5 (a significant change accepted on a
  Preparation and on a Confirmed event returns it to Planning and the decision
  is still recorded), both AC4 next steps, the guards (missing or unknown next
  step, another coordinator, already decided, refusal after apply), the record
  checks, and no EXECUTE for `authenticated` or `anon`. Sabotage runs (EXECUTE
  granted to `authenticated`; the refusal-after-apply guard removed; the
  refusal-reason check dropped; SG2-66's return to Planning disabled) each made
  it fail, naming the case.
- A decision on an event reassigned to another coordinator in the meantime
  (`not_found` from the function) answers 404, like any event not assigned to
  the caller.
- `server/src/changeRequestsDecide.test.ts`, `server/src/db/changeRequests.test.ts`.
- `client/src/components/ChangeRequestsPanel.decisions.test.tsx`,
  `client/src/api/changeRequestDecisions.test.ts`.
- `e2e/change-request-decisions.spec.ts` (SG2-65-P01, SG2-65-P02,
  SG2-65-N01) against the loopback mirror in `e2e/support/change-requests.ts`,
  with the refusal form checked at 390px and 1440px.
