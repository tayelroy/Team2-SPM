# Operational safety check decisions (SG2-92, SG2-93, SG2-94)

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
- **Request Changes.** The event returns to Planning, and the named arrangements go
  back to be confirmed again (SG2-93, below).

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

## Request Changes sends arrangements back (SG2-93)

"Send an event back to planning when safety changes are requested." In the same
transaction as the decision, `record_safety_decision`:

- **AC1** marks each named arrangement outstanding with its own recheck key,
  `safety_venue_recheck`, `safety_equipment_recheck` or `safety_other_recheck`, after
  any keys already outstanding. An outstanding key keeps the event out of Awaiting
  Safety Check (SG2-91's `safety_check_arrangements_ready`), so no unrelated
  arrangement change can put it back on the Safety Officer's list early.
- **AC2** flags every live (pending or approved) venue booking request of the event when
  Venue is named, and every live equipment request when Equipment and technical is
  named, in `public.safety_rereviews`. Venue Staff and Technical Support see their
  flags, with the Safety Officer's reason, under "Safety changes to confirm" on their
  work queue, and confirm each again. A new venue, layout or piece of equipment the
  coordinator asks for goes to them through the existing request paths.
- **AC3** flags and marks nothing the Safety Officer did not name. No booking,
  request or reservation is released or reopened.

**Returning to the check (AC4).** When Venue Staff or Technical Support confirm the last
flag of their kind again, or that request is withdrawn, released or rejected, the
matching key settles on its own. The coordinator marks Other done ("Mark other safety
changes done"); they can also settle a venue or equipment key that had nothing to flag
(say, equipment the event had not requested yet). While a flag is open, the
coordinator's attempt is refused and lists each request still waiting on staff. Once
nothing is outstanding, SG2-91's refresh returns the event to Awaiting Safety Check,
recorded in its history.

**History (AC5).** Every decision stays in `event_safety_decisions`. Each flag keeps the
decision it came from and how it was resolved (`confirmed` by whom, or `withdrawn`),
each confirmation is a `safety_rereview` history row
(`Venue Staff confirmed Regression Hall (10 Jul 2030 10:00 – 14:00 SGT) again`), and
each settled key is an `arrangement_recheck` row (`safety_venue_recheck settled`). The
organiser and the assigned coordinator see, under the latest decision, what was sent
back and where each item stands.

Notices are SG2-92's; staff are not notified when a flag arrives (their work queue
shows it), and SG2-69's reminders still list only the coordinator's own outstanding
venue, equipment and registration work.

## API

| Route | Who | Result |
| --- | --- | --- |
| `POST /api/event-requests/:eventId/safety-decision` | Safety Officer | body `{ decision, reason?, arrangements?, safety_check_revision }`; 201 `{ decision, previous_status, status }`; 400 `Invalid safety decision` with `details`; 404; 409 `{ error, status }` when the check is closed; 409 `{ error, code: 'stale', revision }` when the event changed |
| `GET /api/event-requests/:eventId/safety-decisions` | Safety Officer; the assigned coordinator; the organiser who created it | `{ decisions, rereviews }`, newest first (SG2-93 adds `rereviews`: `{ review_id, decision_id, arrangement, label, flagged_at, resolution, resolved_by_name, resolved_at }`); 404 for anyone else |
| `POST /api/event-requests/:eventId/rework` | the assigned coordinator | 200 `{ event_id, status: 'planning' }`; 404; 409 unless Safety Rejected |
| `GET /api/safety-rereviews` (SG2-93) | Venue Staff (venue flags); Technical Support (equipment flags), by acting role | `{ arrangement, rereviews }`, open flags oldest first, each with the event, coordinator, the Safety Officer's reason and who decided, and the layout or placement |
| `POST /api/safety-rereviews/:reviewId/confirm` (SG2-93) | the staff role the flag belongs to, acting as that role | 200 `{ review_id, event_id, status, outstanding_arrangements }`; 400 bad id; 403; 404; 409 already confirmed or withdrawn |
| `POST /api/event-requests/:eventId/rechecks/:key/settle` (SG2-66) | the assigned coordinator | also takes the three `safety_*_recheck` keys; 409 with `blockers` while staff have not confirmed a flagged request again |

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

Migration `supabase/migrations/202610240001_safety_changes_requested.sql` (SG2-93) adds
`safety_rereviews` (RLS forced, service role only) and replaces `record_safety_decision`
and SG2-66's `settle_arrangement_recheck` from their latest bodies. It also adds
`confirm_safety_rereview`, `safety_rereview_queue` and `event_safety_rereviews`
(service role only), and a trigger that closes a flag when its request is withdrawn,
released or rejected. `confirm_safety_rereview` takes the acting role (SG2-104) as
well as the actor, and both must match the flag's kind.
`supabase/tests/safety_changes_requested.sql` covers each AC with the real writers.

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
