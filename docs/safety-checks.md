# Operational safety check decisions (SG2-92, SG2-94)

"Record an operational safety check decision." The Safety Officer reviews an event
that is Awaiting Safety Check and records one of three decisions: Approve, Reject or
Request Changes. Each decision moves the event on, is recorded with who made it, when
and why, and is sent to the event's organiser and assigned coordinator.

## Where the decision is made: SG2-91's list

SG2-91 (Lim Dao Jun) owns the Safety Officer's list of events awaiting a check
(`GET /api/safety-checks`, permission `safety_checks.read`), the review details it
shows, and the automatic move into Awaiting Safety Check once an event's venue
bookings are approved and its equipment is reserved. The Safety desk cards and the
Safety checks screen (`client/src/screens/SafetyChecks.tsx`) are his. SG2-92 adds,
on each event's review, its earlier decisions and the Approve / Reject / Request
Changes form (`client/src/components/SafetyDecisionForm.tsx`). After a decision the
list is read again, so the decided event leaves it.

Nothing in SG2-92 moves an event into Awaiting Safety Check. The browser fixture
(`e2e/support/safety-decisions.ts`) and the integration test put events there
directly.

## Deciding on what was reviewed

SG2-91's list returns each event's `safety_check_revision`, which moves on whenever
the event enters or leaves the check or a reviewed detail changes. The decision
carries back the revision the Safety Officer saw (`safety_check_revision` in the
request body). If the event has changed since, the decision is refused with
409 `{ error, code: 'stale', revision }` and nothing is written; the screen shows
"This event changed after you opened it. Refresh the safety checks and review it
again." and reads the list again, so the Safety Officer decides on the event as it
now stands.

## Decisions

| Decision | Needs | Event moves to |
| --- | --- | --- |
| Approve | an optional note | Preparation (AC3) |
| Reject | a reason | Safety Rejected (AC4) |
| Request Changes | a reason and at least one arrangement: Venue, Equipment and technical, Other | Planning |

- A reason is at most 2000 characters, counted as characters (an emoji is one).
- Arrangements are named only with Request Changes, each once, in the order given.
- A decision can only be recorded while the event is `awaiting_safety_check`; a second
  decision, or one on an event that moved on, is refused with its current status (409).
- The revision must be the whole number the list showed (0 or more); a missing or
  malformed one is refused (400), a different one is stale (409).
- The server (`validateSafetyDecision`) and the database function apply the same rules.
- **Reject (AC4).** The event is shown as Safety Rejected and cannot move on to
  Preparation. Its assigned coordinator reworks it back to Planning ("Rework
  arrangements"), fixes the arrangements and resubmits them for a new check. The
  status flow now allows `safety_rejected → planning`.
- **Request Changes.** The event returns to Planning here. Flagging the named
  arrangements outstanding, and returning the event to Awaiting Safety Check once they
  are confirmed again, are SG2-93.

## Notices and history (AC5, AC6)

The organiser and the assigned coordinator each get one `safety_decision` notice
(shown as "Safety check"), with the event name (or "Untitled event") and the reason:

- Approve: `<event> passed its operational safety check and has moved to Preparation.`
  plus ` Note: <note>` when one was given;
- Reject: `<event> did not pass its operational safety check: <reason>. The coordinator will rework the arrangements for a new check.`
- Request Changes: `<event> needs changes before it can pass its operational safety check (<arrangements>): <reason>. It has moved back to Planning.`

The event history gets a `safety_decision` row (`Approved`, `Rejected: <reason>` or
`Changes requested (<arrangements>): <reason>`) and the status change. Every decision is
also kept, append-only, in `public.event_safety_decisions` (who, when, decision, reason,
arrangements). The Safety Officer sees an event's earlier decisions before deciding;
the organiser and the assigned coordinator see the latest decision on the event.

## API

| Route | Who | Result |
| --- | --- | --- |
| `POST /api/event-requests/:eventId/safety-decision` | Safety Officer | body `{ decision, reason?, arrangements?, safety_check_revision }`; 201 `{ decision, previous_status, status }`; 400 `Invalid safety decision` with `details`; 404; 409 `{ error, status }` when the check is closed; 409 `{ error, code: 'stale', revision }` when the event changed |
| `GET /api/event-requests/:eventId/safety-decisions` | Safety Officer; the assigned coordinator; the organiser who created it | `{ decisions }`, newest first; 404 for anyone else |
| `POST /api/event-requests/:eventId/rework` | the assigned coordinator | 200 `{ event_id, status: 'planning' }`; 404; 409 unless Safety Rejected |

The list itself is SG2-91's `GET /api/safety-checks`.

## Database

Migration `supabase/migrations/202610190005_safety_decisions.sql` adds the
`event_safety_decisions` table (RLS forced, service role only, no update or delete
grant), the `safety_decision` notice kind, and two `security definer` functions
executable only by the service role:

- `record_safety_decision`, which rechecks the Safety Officer role, the event's status
  and the input under the event row lock, then writes the decision, the status, the
  history and the notices in one transaction;
- `rework_safety_rejected_event`, for the assigned coordinator only.

Migration `supabase/migrations/202610190006_safety_decision_revision.sql` replaces
`record_safety_decision` with a six-argument version whose last argument is the
revision the Safety Officer reviewed; it answers `{ outcome: 'stale', revision }`,
under the same row lock, when the event's `safety_check_revision` differs. The
five-argument version no longer exists.

`supabase/tests/safety_decisions.sql` covers each decision, validation boundaries,
refusals, the stale revision, rework and the grants.

## Safety approval gates Preparation and confirmation (SG2-94)

An event's **safety approval** is its latest decision when that decision is Approve
and the event is still in Preparation or Confirmed. Every way back (an accepted
change, a planning edit, an unavailable venue) moves the event to Planning, which
ends the approval without rewriting the decision history.
`public.event_safety_approved(events)` applies the rule in the database and
`isSafetyApproved` in `server/src/events/arrangementReadiness.ts` mirrors it.

- **AC1/AC2.** The `safety_approval_gate` trigger on `public.events` refuses any
  move into Preparation unless the event is leaving Awaiting Safety Check on an
  Approve made during that wait. The refusal is a `check_violation` on
  `events_preparation_needs_safety_approval` with the message "An event can move to
  Preparation only once the Safety Officer has approved its safety check." and a
  detail naming the status and the latest decision. `record_safety_decision`'s
  Approve is the only writer that passes; an older Approve from an earlier wait
  does not count.
- **AC3.** When an accepted change request alters a significant field (date and time,
  attendance, venue, accessibility or equipment requirements) of an event in
  Preparation or Confirmed, `apply_accepted_event_change` returns it to Planning even
  when no recheck was named, clears its confirmation and adds a `safety_approval`
  history row ("Withdrawn: the accepted <change request> changed what was approved, so
  the event must pass the safety check again"). SG2-91 brings it back to Awaiting
  Safety Check once its arrangements are in place; a new Approve is needed. A change to
  the name, purpose or description keeps the approval. The coordinator's and the
  organiser's Latest safety decision panel says the approval was withdrawn.
- **AC4/AC5.** The coordinator's arrangement readiness panel lists **Safety check** as
  an item after venue, equipment and registration: Ready ("Approved by the Safety
  Officer.") or Outstanding with the reason (awaiting the check, rejected, changes
  requested, approval withdrawn, or not approved yet). `confirm_event` lists `safety`
  among the outstanding items unless the event holds a current approval, and answers
  an attempt on an event in Approved, Planning, Awaiting Safety Check or Safety
  Rejected with what is outstanding instead of "closed". This replaces SG2-58 AC1's
  venue-and-equipment rule.
- **AC6.** Registration settings no longer hold confirmation up: an event that needs
  registration can be confirmed before its capacity and times are set; the Event
  Organiser sets them (SG2-63) and attendees can register once registration opens.
  An outstanding SG2-66 registration recheck still blocks, and its recheck no longer
  waits for a closing time that is not set.

Migration `supabase/migrations/202610220001_safety_approval_gate.sql` adds the
function and the trigger and replaces `apply_accepted_event_change` and
`confirm_event`. `supabase/tests/safety_approval_gate.sql` covers the gate, the
withdrawal and confirmation on the safety check; `supabase/tests/event_confirmation.sql`
covers the outstanding order and the registration rule. The release readiness check
requires the trigger and the safety approval in `confirm_event`.

## Follow-ups

- **SG2-93**: on Request Changes, mark the named arrangements outstanding and return the
  event to Awaiting Safety Check once they are confirmed again.
