# Clarification exchange — SG2-36

A coordinator reviewing a request can ask its organiser a question instead of
deciding on incomplete information. The question returns the request to the
organiser, who answers, amends and resubmits it. The exchange stays attached to
the event, so both sides can read what was asked and answered.

## Behaviour

| Step | Who | What happens |
| --- | --- | --- |
| Ask | Assigned coordinator, request `under_review` | Work queue → request → **Clarification** panel → Send. The status becomes `needs_clarification`, the decision panel is hidden, and the change is written to the event audit log (SG2-39). |
| Follow up | Assigned coordinator, request `needs_clarification` | Further messages are appended; the status is unchanged. |
| See | Owning organiser | The event page shows "Your coordinator has a question" and the thread. The request counts in **My drafts** and **Waiting on me**. |
| Answer | Owning organiser | The event page offers a reply box while the request is `needs_clarification`. Organiser messages are appended and never change the status. |
| Amend and resubmit | Owning organiser | **My drafts** lists the request with **Edit** but no **Delete**. Editing and submitting accept `needs_clarification`; submitting sets `submitted`. |
| Review again | Assigned coordinator | The resubmitted request is back in **Awaiting review**; opening it moves it to `under_review` (SG2-35) with the full thread visible. |

While a request is `needs_clarification` it is waiting on the organiser, so it
does not appear in the coordinator's work queue until it is resubmitted.
"Notified" is in-app only: there is no email or push notification yet
(SG2-68/69).

## API

Both routes require the `event_request.clarify` permission (Event Coordinator,
Event Organiser) and then participation in the request. Anyone else receives
`404`, so the endpoint does not reveal which requests exist.

| Route | Result |
| --- | --- |
| `GET /api/event-requests/:eventId/clarifications` | `200 { clarifications, status }`, oldest message first. |
| `POST /api/event-requests/:eventId/clarifications` with `{ "message": "..." }` | `201 { clarification, status }`. Messages are trimmed and must be 1–5000 characters (`400` otherwise). A coordinator's first message on an `under_review` request returns it; if the request was decided or reassigned in the meantime the call returns `404` and nothing is stored. |

Storage failures return `503` without database details.

## Database

Migration `supabase/migrations/202609300001_event_clarifications.sql` adds:

- the `needs_clarification` value to `public.event_status`;
- `public.event_clarifications` (`event_id`, `sender_id`, `message`,
  `created_at`), with a non-blank message check and cascading delete with its
  event.

Row-level security is enabled and forced. Direct reads match the API: only the
assigned coordinator and the owning organiser can read a thread, checked by
`public.is_clarification_participant(event_id)` (migration
`202610020001_event_clarifications_participant_read.sql`, a `security definer`
function because coordinators cannot read `events` rows directly). Other
coordinators, venue staff, technical support staff and attendees see nothing,
and a coordinator loses access as soon as the request is reassigned. No client
role may insert, update or delete, so the API (service role) is the only writer
and the thread is append-only. `anon` has no access.

Both migrations must be applied to the hosted Supabase project, in filename
order: `202609300001` was applied on 2 October 2026, and `202610020001`
replaces its read policy.

## Verification

| Layer | Evidence |
| --- | --- |
| Database | `supabase/tests/event_clarifications.sql` (CI database job) |
| API | `server/src/clarifications.test.ts`, `server/src/db/clarifications.test.ts` |
| UI | `client/src/components/ClarificationThread.test.tsx`, `WorkQueue`, `EventDetail`, `DraftRequests` and `Dashboard` tests |
| Browser journeys | `SG2-36-P01` and `SG2-36-N01` in `e2e/regression.spec.ts` |

Scenario records are in [regression-cases.json](regression-cases.json); every
tagged method is in [test-case-inventory.json](test-case-inventory.json).
