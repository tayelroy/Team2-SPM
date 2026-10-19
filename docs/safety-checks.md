# Operational safety check decisions (SG2-92)

"Record an operational safety check decision." The Safety Officer reviews an event
that is Awaiting Safety Check and records one of three decisions: Approve, Reject or
Request Changes. Each decision moves the event on, is recorded with who made it, when
and why, and is sent to the event's organiser and assigned coordinator.

## The list of events is a stand-in for SG2-91

SG2-91 (Lim Dao Jun) owns the Safety Officer's list of events awaiting a check, the
review details it shows, and the automatic move into Awaiting Safety Check once an
event's venue bookings are approved and its equipment is reserved. None of that has
shipped yet. Until it does, `GET /api/safety-checks` serves a labelled stand-in,
`server/src/safetyChecks/standInQueue.ts`: the events already in
`awaiting_safety_check` with the review details available today (date, attendance,
accessibility needs, coordinator, confirmed venue bookings with capacity, and live
equipment requests with their placement). The desk says the list is a stand-in.

Nothing in SG2-92 moves an event into Awaiting Safety Check. The browser fixture
(`e2e/support/safety-decisions.ts`) and the integration test put events there
directly. SG2-91 replaces the stand-in by passing its own `SafetyCheckQueue`
(`list(admin)`) to `createSafetyCheckHandlers` in `server/src/events/safetyChecks.ts`.
No SG2-92 logic changes.

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
| `GET /api/safety-checks` | Safety Officer | `{ source: 'stand-in', events }` |
| `POST /api/event-requests/:eventId/safety-decision` | Safety Officer | 201 `{ decision, previous_status, status }`; 400 `Invalid safety decision` with `details`; 404; 409 `{ error, status }` |
| `GET /api/event-requests/:eventId/safety-decisions` | Safety Officer; the assigned coordinator; the organiser who created it | `{ decisions }`, newest first; 404 for anyone else |
| `POST /api/event-requests/:eventId/rework` | the assigned coordinator | 200 `{ event_id, status: 'planning' }`; 404; 409 unless Safety Rejected |

## Database

Migration `supabase/migrations/202610190004_safety_decisions.sql` adds the
`event_safety_decisions` table (RLS forced, service role only, no update or delete
grant), the `safety_decision` notice kind, and two `security definer` functions
executable only by the service role:

- `record_safety_decision`, which rechecks the Safety Officer role, the event's status
  and the input under the event row lock, then writes the decision, the status, the
  history and the notices in one transaction;
- `rework_safety_rejected_event`, for the assigned coordinator only.

`supabase/tests/safety_decisions.sql` covers each decision, validation boundaries,
refusals, rework and the grants.

## Follow-ups

- **SG2-93**: on Request Changes, mark the named arrangements outstanding and return the
  event to Awaiting Safety Check once they are confirmed again.
- **SG2-94**: treat only an event's latest decision, when it is Approve, as its safety
  approval. SG2-66's `apply_accepted_event_change` already sends a Preparation or
  Confirmed event back to Planning, so the approval no longer applies there and a new
  check is needed; the decision history itself is never rewritten.
